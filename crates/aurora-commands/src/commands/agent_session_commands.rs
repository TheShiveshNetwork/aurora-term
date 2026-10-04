use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tauri::{command, State};

use aurora_core::AppError;
use aurora_db::{
    project_id_for, AgentMessageRecord, AgentProjectRecord, AgentSessionListItem,
    AgentSessionPatch, AgentSessionRecord, AgentStorageStats, PruneReport, RetentionPolicy,
    TitleSource,
};

use crate::state::AppState;

/// Wire payload for a partial session update. Every field is optional so the
/// frontend can send a sparse patch (just a status change, just a title) without
/// the command layer needing to know the full session shape.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionPatchInput {
    pub id: String,
    pub project_id: String,
    pub title: Option<String>,
    pub title_source: Option<String>,
    pub summary: Option<String>,
    pub goal: Option<String>,
    pub first_prompt: Option<String>,
    pub agent_type: Option<String>,
    pub agent_mode: Option<String>,
    pub model: Option<String>,
    pub status: Option<String>,
    pub state: Option<String>,
}

impl AgentSessionPatchInput {
    fn title_source(&self) -> Option<TitleSource> {
        self.title_source.as_deref().map(TitleSource::parse)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRestored {
    #[serde(flatten)]
    pub session: AgentSessionListItem,
    pub messages: Vec<AgentMessageRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionHydration {
    pub project: AgentProjectRecord,
    pub sessions: Vec<AgentSessionRestored>,
}

#[command]
pub async fn agent_session_open_project(
    state: State<'_, AppState>,
    path: String,
    label: Option<String>,
) -> Result<AgentProjectRecord, AppError> {
    let db = state.history_db.lock().await;
    let id = project_id_for(&path);
    db.touch_agent_project(&id, &path, label.as_deref())
}

#[command]
pub async fn agent_session_list(
    state: State<'_, AppState>,
    project_id: String,
    include_archived: Option<bool>,
    limit: Option<usize>,
) -> Result<Vec<AgentSessionListItem>, AppError> {
    let db = state.history_db.lock().await;
    db.list_agent_sessions(&project_id, include_archived.unwrap_or(false), limit.unwrap_or(200))
}

/// Resolves a project id from its path and returns every stored session with its
/// transcript, so opening the Agent view costs a single IPC round trip. The
/// retention sweep is expected to have run first, which bounds how much comes
/// back.
#[command]
pub async fn agent_session_hydrate(
    state: State<'_, AppState>,
    path: String,
    label: Option<String>,
) -> Result<AgentSessionHydration, AppError> {
    let db = state.history_db.lock().await;
    let id = project_id_for(&path);
    let project = db.touch_agent_project(&id, &path, label.as_deref())?;
    let sessions = db
        .list_agent_sessions(&id, false, 200)?
        .into_iter()
        .map(|session| {
            let messages = db.list_agent_messages(&session.session.id)?;
            Ok(AgentSessionRestored { session, messages })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(AgentSessionHydration { project, sessions })
}

#[command]
pub async fn agent_session_upsert(
    state: State<'_, AppState>,
    patch: AgentSessionPatchInput,
) -> Result<AgentSessionRecord, AppError> {
    let db = state.history_db.lock().await;
    let title_source = patch.title_source();
    let mut builder = AgentSessionPatch::new(patch.id, patch.project_id);
    if let Some(title) = patch.title {
        builder = builder.title(title, title_source.unwrap_or(TitleSource::Placeholder));
    }
    if let Some(status) = patch.status {
        builder = builder.status(status);
    }
    if let Some(goal) = patch.goal {
        builder = builder.goal(goal);
    }
    if let Some(prompt) = patch.first_prompt {
        builder = builder.first_prompt(prompt);
    }
    if let (Some(t), Some(m)) = (patch.agent_type, patch.agent_mode) {
        builder = builder.agent(t, m);
    }
    if patch.model.is_some() {
        builder = builder.model(patch.model);
    }
    if let Some(state) = patch.state {
        builder = builder.state_json(state);
    }
    db.upsert_agent_session(&builder)
}

#[command]
pub async fn agent_session_rename(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<(), AppError> {
    let db = state.history_db.lock().await;
    db.rename_agent_session(&id, &title)
}

#[command]
pub async fn agent_session_set_pinned(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<(), AppError> {
    let db = state.history_db.lock().await;
    db.set_agent_session_pinned(&id, pinned)
}

#[command]
pub async fn agent_session_set_archived(
    state: State<'_, AppState>,
    id: String,
    archived: bool,
) -> Result<(), AppError> {
    let db = state.history_db.lock().await;
    db.set_agent_session_archived(&id, archived)
}

#[command]
pub async fn agent_session_replace_messages(
    state: State<'_, AppState>,
    session_id: String,
    messages: Vec<AgentMessageRecord>,
) -> Result<(), AppError> {
    let db = state.history_db.lock().await;
    db.replace_agent_messages(&session_id, &messages)
}

#[command]
pub async fn agent_session_load(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<(AgentSessionRecord, Vec<AgentMessageRecord>)>, AppError> {
    let db = state.history_db.lock().await;
    db.load_agent_session(&id)
}

#[command]
pub async fn agent_session_delete(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let db = state.history_db.lock().await;
    db.delete_agent_session(&id)
}

#[command]
pub async fn agent_session_delete_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), AppError> {
    let db = state.history_db.lock().await;
    db.delete_agent_project(&project_id)
}

#[command]
pub async fn agent_session_storage_stats(
    state: State<'_, AppState>,
) -> Result<AgentStorageStats, AppError> {
    let db = state.history_db.lock().await;
    db.agent_storage_stats()
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionPruneInput {
    pub max_total_bytes: Option<i64>,
    pub max_session_bytes: Option<i64>,
    pub min_age_ms: Option<i64>,
    pub keep_message_bodies: Option<i64>,
    pub protect: Option<Vec<String>>,
}

#[command]
pub async fn agent_session_prune(
    state: State<'_, AppState>,
    input: AgentSessionPruneInput,
) -> Result<PruneReport, AppError> {
    let db = state.history_db.lock().await;
    let mut builder = RetentionPolicy::builder();
    if let Some(v) = input.max_total_bytes {
        builder = builder.max_total_bytes(v);
    }
    if let Some(v) = input.max_session_bytes {
        builder = builder.max_session_bytes(v);
    }
    if let Some(v) = input.min_age_ms {
        builder = builder.min_age_ms(v);
    }
    if let Some(v) = input.keep_message_bodies {
        builder = builder.keep_message_bodies(v);
    }
    let protect: HashSet<String> = input.protect.unwrap_or_default().into_iter().collect();
    db.prune_agent_sessions(&builder.build(), &protect)
}
