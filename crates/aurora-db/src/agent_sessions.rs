//! Durable per-project agent chat history.
//!
//! Only Agent-view sessions are stored here — terminal-agent tabs stay ephemeral
//! and are deliberately excluded. A session is scoped to the project directory it
//! was created in, mirroring how Antigravity scopes conversation histories to the
//! cwd they were launched from.
//!
//! The rows in this module are the single source of truth for the session list.
//! The sidecar's Mastra thread is a derived cache of LLM context (see
//! `packages/aurora-agent/src/agents/shared/durable-storage.ts`); losing it costs
//! recall continuity but never history, so the list is never rebuilt from a
//! separate index that could desync from the data.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use aurora_core::AppError;

use crate::db::HistoryDb;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS agent_projects (
    id           TEXT PRIMARY KEY,
    path         TEXT NOT NULL,
    label        TEXT,
    last_opened  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_sessions (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES agent_projects(id) ON DELETE CASCADE,
    title         TEXT,
    title_source  TEXT NOT NULL DEFAULT 'auto',
    summary       TEXT,
    goal          TEXT,
    first_prompt  TEXT,
    agent_type    TEXT NOT NULL DEFAULT 'developer',
    agent_mode    TEXT NOT NULL DEFAULT 'build',
    model         TEXT,
    status        TEXT NOT NULL DEFAULT 'idle',
    message_count INTEGER NOT NULL DEFAULT 0,
    pinned        INTEGER NOT NULL DEFAULT 0,
    archived      INTEGER NOT NULL DEFAULT 0,
    state         TEXT NOT NULL DEFAULT '{}',
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_list
    ON agent_sessions(project_id, archived, pinned DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_messages_seq
    ON agent_messages(session_id, seq);
"#;

/// A session row as stored. `state` carries the frontend's non-message UI state
/// (chain nodes, file changes, queue) so reopening a chat restores the run
/// timeline and not just the transcript.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRecord {
    pub id: String,
    pub project_id: String,
    pub title: Option<String>,
    pub title_source: String,
    pub summary: Option<String>,
    pub goal: Option<String>,
    pub first_prompt: Option<String>,
    pub agent_type: String,
    pub agent_mode: String,
    pub model: Option<String>,
    pub status: String,
    pub message_count: i64,
    pub pinned: bool,
    pub archived: bool,
    pub state: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageRecord {
    pub id: String,
    pub session_id: String,
    pub seq: i64,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProjectRecord {
    pub id: String,
    pub path: String,
    pub label: Option<String>,
    pub last_opened: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionListItem {
    #[serde(flatten)]
    pub session: AgentSessionRecord,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStorageStats {
    pub sessions: i64,
    pub projects: i64,
    pub bytes: i64,
}

impl Default for AgentStorageStats {
    fn default() -> Self {
        Self {
            sessions: 0,
            projects: 0,
            bytes: 0,
        }
    }
}

/// Title precedence. A slower producer can never clobber a faster, more
/// authoritative one: `manual` > `model` > `placeholder` > `none`. A placeholder
/// is the random `session_1234` shown until the agent names the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TitleSource {
    None,
    Placeholder,
    Model,
    Manual,
}

impl TitleSource {
    pub fn parse(raw: &str) -> Self {
        match raw {
            "manual" => TitleSource::Manual,
            "model" => TitleSource::Model,
            "placeholder" => TitleSource::Placeholder,
            _ => TitleSource::None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            TitleSource::None => "none",
            TitleSource::Placeholder => "placeholder",
            TitleSource::Model => "model",
            TitleSource::Manual => "manual",
        }
    }
}

/// Builder for the partial session updates the frontend streams in. The frontend
/// owns the shape of `SessionAgentState`, so instead of a wide fixed payload we
/// accept an optional-field patch and assemble the row in one place.
#[derive(Debug, Clone, Default)]
pub struct AgentSessionPatch {
    pub id: String,
    pub project_id: String,
    pub title: Option<String>,
    pub title_source: Option<TitleSource>,
    pub summary: Option<String>,
    pub goal: Option<String>,
    pub first_prompt: Option<String>,
    pub agent_type: Option<String>,
    pub agent_mode: Option<String>,
    pub model: Option<String>,
    pub status: Option<String>,
    pub state: Option<String>,
}

impl AgentSessionPatch {
    pub fn new(id: impl Into<String>, project_id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            project_id: project_id.into(),
            ..Default::default()
        }
    }

    pub fn title(mut self, title: impl Into<String>, source: TitleSource) -> Self {
        self.title = Some(title.into());
        self.title_source = Some(source);
        self
    }

    pub fn status(mut self, status: impl Into<String>) -> Self {
        self.status = Some(status.into());
        self
    }

    pub fn goal(mut self, goal: impl Into<String>) -> Self {
        self.goal = Some(goal.into());
        self
    }

    pub fn first_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.first_prompt = Some(prompt.into());
        self
    }

    pub fn agent(mut self, agent_type: impl Into<String>, mode: impl Into<String>) -> Self {
        self.agent_type = Some(agent_type.into());
        self.agent_mode = Some(mode.into());
        self
    }

    pub fn model(mut self, model: Option<String>) -> Self {
        self.model = model;
        self
    }

    pub fn state_json(mut self, state: impl Into<String>) -> Self {
        self.state = Some(state.into());
        self
    }
}

/// Retention policy for pruning stored history. Built rather than passed as a
/// bag of arguments so the defaults live in one readable place.
#[derive(Debug, Clone)]
pub struct RetentionPolicy {
    pub max_total_bytes: i64,
    pub max_session_bytes: i64,
    pub min_age_ms: i64,
    pub keep_message_bodies: i64,
    pub search_preview_chars: i64,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            max_total_bytes: 250 * 1024 * 1024,
            max_session_bytes: 24 * 1024 * 1024,
            min_age_ms: 7 * 24 * 60 * 60 * 1000,
            keep_message_bodies: 400,
            search_preview_chars: 200,
        }
    }
}

impl RetentionPolicy {
    pub fn builder() -> RetentionPolicyBuilder {
        RetentionPolicyBuilder::default()
    }
}

#[derive(Debug, Clone, Default)]
pub struct RetentionPolicyBuilder {
    policy: RetentionPolicy,
}

impl RetentionPolicyBuilder {
    pub fn max_total_bytes(mut self, bytes: i64) -> Self {
        self.policy.max_total_bytes = bytes;
        self
    }

    pub fn max_session_bytes(mut self, bytes: i64) -> Self {
        self.policy.max_session_bytes = bytes;
        self
    }

    pub fn min_age_ms(mut self, ms: i64) -> Self {
        self.policy.min_age_ms = ms;
        self
    }

    pub fn keep_message_bodies(mut self, count: i64) -> Self {
        self.policy.keep_message_bodies = count;
        self
    }

    pub fn build(self) -> RetentionPolicy {
        self.policy
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PruneReport {
    pub dropped_sessions: Vec<String>,
    pub trimmed_sessions: Vec<String>,
    pub bytes_before: i64,
    pub bytes_after: i64,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Stable id for a project path. Lowercased and separator-normalized so the same
/// folder reached through different spellings maps to one history.
pub fn project_id_for(path: &str) -> String {
    let mut normalized = path.trim().replace('\\', "/").to_lowercase();
    while normalized.ends_with('/') && normalized.len() > 1 {
        normalized.pop();
    }
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in normalized.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("p{hash:016x}")
}

impl HistoryDb {
    pub fn migrate_agent_sessions(conn: &Connection) -> Result<(), AppError> {
        conn.execute_batch(SCHEMA)
            .map_err(|e| AppError::Db(e.to_string()))
    }

    pub fn touch_agent_project(
        &self,
        project_id: &str,
        path: &str,
        label: Option<&str>,
    ) -> Result<AgentProjectRecord, AppError> {
        let now = now_ms();
        self.conn
            .execute(
                "INSERT INTO agent_projects (id, path, label, last_opened)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET last_opened = ?4, label = COALESCE(?3, label)",
                params![project_id, path, label, now],
            )
            .map_err(|e| AppError::Db(e.to_string()))?;
        self.get_agent_project(project_id)
    }

    pub fn get_agent_project(&self, project_id: &str) -> Result<AgentProjectRecord, AppError> {
        self.conn
            .query_row(
                "SELECT id, path, label, last_opened FROM agent_projects WHERE id = ?1",
                [project_id],
                |row| {
                    Ok(AgentProjectRecord {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        label: row.get(2)?,
                        last_opened: row.get(3)?,
                    })
                },
            )
            .map_err(|e| AppError::Db(e.to_string()))
    }

    /// Insert-or-merge. A title is only replaced when the incoming source
    /// outranks the stored one, so a late model response cannot undo a rename.
    pub fn upsert_agent_session(
        &self,
        patch: &AgentSessionPatch,
    ) -> Result<AgentSessionRecord, AppError> {
        let now = now_ms();
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| AppError::Db(e.to_string()))?;

        tx.execute(
            "INSERT OR IGNORE INTO agent_projects (id, path, label, last_opened)
             VALUES (?1, '', NULL, ?2)",
            params![patch.project_id, now],
        )
        .map_err(|e| AppError::Db(e.to_string()))?;

        tx.execute(
            "INSERT OR IGNORE INTO agent_sessions (id, project_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params![patch.id, patch.project_id, now],
        )
        .map_err(|e| AppError::Db(e.to_string()))?;

        let existing: Option<(String, String, i64)> = tx
            .query_row(
                "SELECT title_source, project_id, created_at FROM agent_sessions WHERE id = ?1",
                [&patch.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| AppError::Db(e.to_string()))?;

        let (stored_source, _, _) =
            existing.ok_or_else(|| AppError::Db("session upsert failed".into()))?;

        let incoming = patch.title_source.unwrap_or(TitleSource::None);
        let stored = TitleSource::parse(&stored_source);
        let accepted = if incoming > stored { incoming } else { stored };
        let title = if accepted > stored {
            patch.title.clone()
        } else if incoming == stored && incoming > TitleSource::None {
            patch.title.clone().or(None)
        } else {
            None
        };

        tx.execute(
            "UPDATE agent_sessions SET
                project_id   = ?2,
                title        = COALESCE(?3, title),
                title_source = ?4,
                summary      = COALESCE(?5, summary),
                goal         = COALESCE(?6, goal),
                first_prompt = COALESCE(?7, first_prompt),
                agent_type   = COALESCE(?8, agent_type),
                agent_mode   = COALESCE(?9, agent_mode),
                model        = COALESCE(?10, model),
                status       = COALESCE(?11, status),
                state        = COALESCE(?12, state),
                updated_at   = ?13
             WHERE id = ?1",
            params![
                patch.id,
                patch.project_id,
                title,
                accepted.as_str(),
                patch.summary,
                patch.goal,
                patch.first_prompt,
                patch.agent_type,
                patch.agent_mode,
                patch.model,
                patch.status,
                patch.state,
                now,
            ],
        )
        .map_err(|e| AppError::Db(e.to_string()))?;

        let record = query_session(&tx, &patch.id)?
            .ok_or_else(|| AppError::Db("session upsert failed".into()))?;
        tx.commit().map_err(|e| AppError::Db(e.to_string()))?;
        Ok(record)
    }

    pub fn list_agent_sessions(
        &self,
        project_id: &str,
        include_archived: bool,
        limit: usize,
    ) -> Result<Vec<AgentSessionListItem>, AppError> {
        let archived = if include_archived { "" } else { " AND archived = 0" };
        let sql = format!(
            "SELECT {SESSION_COLUMNS} FROM agent_sessions
             WHERE project_id = ?1{archived}
             ORDER BY pinned DESC, updated_at DESC
             LIMIT ?2"
        );
        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| AppError::Db(e.to_string()))?;

        let rows = stmt
            .query_map(params![project_id, limit as i64], map_list_item)
            .map_err(|e| AppError::Db(e.to_string()))?;

        let mut items = Vec::new();
        for row in rows {
            let mut item = row.map_err(|e| AppError::Db(e.to_string()))?;
            item.preview = item.session.first_prompt.clone();
            items.push(item);
        }
        Ok(items)
    }

    pub fn get_agent_session(&self, id: &str) -> Result<Option<AgentSessionRecord>, AppError> {
        query_session(&self.conn, id)
    }

    pub fn rename_agent_session(&self, id: &str, title: &str) -> Result<(), AppError> {
        self.conn
            .execute(
                "UPDATE agent_sessions SET title = ?2, title_source = 'manual', updated_at = ?3
                 WHERE id = ?1",
                params![id, title, now_ms()],
            )
            .map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    pub fn set_agent_session_pinned(&self, id: &str, pinned: bool) -> Result<(), AppError> {
        self.conn
            .execute(
                "UPDATE agent_sessions SET pinned = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, pinned as i64, now_ms()],
            )
            .map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    pub fn set_agent_session_archived(&self, id: &str, archived: bool) -> Result<(), AppError> {
        self.conn
            .execute(
                "UPDATE agent_sessions SET archived = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, archived as i64, now_ms()],
            )
            .map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    /// Replaces the whole transcript. The frontend owns message identity and
    /// ordering, so a full replace keeps SQLite free of diffing logic and is
    /// idempotent — replaying the same history is a no-op.
    pub fn replace_agent_messages(
        &self,
        session_id: &str,
        messages: &[AgentMessageRecord],
    ) -> Result<(), AppError> {
        let now = now_ms();
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| AppError::Db(e.to_string()))?;

        tx.execute(
            "DELETE FROM agent_messages WHERE session_id = ?1",
            [session_id],
        )
        .map_err(|e| AppError::Db(e.to_string()))?;

        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT OR REPLACE INTO agent_messages (id, session_id, seq, role, content, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .map_err(|e| AppError::Db(e.to_string()))?;
            for msg in messages {
                stmt.execute(params![
                    msg.id,
                    session_id,
                    msg.seq,
                    msg.role,
                    msg.content,
                    msg.created_at
                ])
                .map_err(|e| AppError::Db(e.to_string()))?;
            }
        }

        tx.execute(
            "UPDATE agent_sessions SET message_count = ?2, updated_at = ?3 WHERE id = ?1",
            params![session_id, messages.len() as i64, now],
        )
        .map_err(|e| AppError::Db(e.to_string()))?;

        tx.commit().map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    pub fn list_agent_messages(
        &self,
        session_id: &str,
    ) -> Result<Vec<AgentMessageRecord>, AppError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, session_id, seq, role, content, created_at
                 FROM agent_messages WHERE session_id = ?1 ORDER BY seq ASC",
            )
            .map_err(|e| AppError::Db(e.to_string()))?;
        let rows = stmt
            .query_map([session_id], |row| {
                Ok(AgentMessageRecord {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    seq: row.get(2)?,
                    role: row.get(3)?,
                    content: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| AppError::Db(e.to_string()))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| AppError::Db(e.to_string()))?);
        }
        Ok(out)
    }

    /// Loads a session and its transcript in one call, so the UI can restore a
    /// chat with a single IPC round trip.
    pub fn load_agent_session(
        &self,
        id: &str,
    ) -> Result<Option<(AgentSessionRecord, Vec<AgentMessageRecord>)>, AppError> {
        let Some(session) = self.get_agent_session(id)? else {
            return Ok(None);
        };
        let messages = self.list_agent_messages(id)?;
        Ok(Some((session, messages)))
    }

    pub fn delete_agent_session(&self, id: &str) -> Result<(), AppError> {
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| AppError::Db(e.to_string()))?;
        tx.execute("DELETE FROM agent_messages WHERE session_id = ?1", [id])
            .map_err(|e| AppError::Db(e.to_string()))?;
        tx.execute("DELETE FROM agent_sessions WHERE id = ?1", [id])
            .map_err(|e| AppError::Db(e.to_string()))?;
        tx.commit().map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    pub fn delete_agent_project(&self, project_id: &str) -> Result<(), AppError> {
        self.conn
            .execute("DELETE FROM agent_projects WHERE id = ?1", [project_id])
            .map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    pub fn agent_storage_stats(&self) -> Result<AgentStorageStats, AppError> {
        let sessions: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM agent_sessions", [], |r| r.get(0))
            .map_err(|e| AppError::Db(e.to_string()))?;
        let projects: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM agent_projects", [], |r| r.get(0))
            .map_err(|e| AppError::Db(e.to_string()))?;
        let bytes = self.database_bytes()?;
        Ok(AgentStorageStats {
            sessions,
            projects,
            bytes,
        })
    }

    pub fn database_bytes(&self) -> Result<i64, AppError> {
        let page_count: i64 = self
            .conn
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .unwrap_or(0);
        let page_size: i64 = self
            .conn
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .unwrap_or(0);
        Ok(page_count * page_size)
    }

    /// Enforces the retention budget. Runs oldest-first eviction over unpinned,
    /// unarchived sessions, then shrinks oversized survivors and reclaims free
    /// pages. `protect` holds ids that must survive regardless of age (the
    /// session the user is currently looking at).
    pub fn prune_agent_sessions(
        &self,
        policy: &RetentionPolicy,
        protect: &HashSet<String>,
    ) -> Result<PruneReport, AppError> {
        let now = now_ms();
        let mut report = PruneReport {
            bytes_before: self.database_bytes()?,
            ..Default::default()
        };

        let candidates: Vec<(String, i64, i64)> = {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT id, updated_at,
                            COALESCE((SELECT SUM(LENGTH(content)) FROM agent_messages m
                                      WHERE m.session_id = s.id), 0)
                     FROM agent_sessions s
                     WHERE pinned = 0 AND archived = 0
                     ORDER BY updated_at ASC",
                )
                .map_err(|e| AppError::Db(e.to_string()))?;
            let rows = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(|e| AppError::Db(e.to_string()))?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|e| AppError::Db(e.to_string()))?);
            }
            out
        };

        let mut retained_bytes: i64 = 0;
        for (id, updated_at, content_bytes) in candidates {
            if protect.contains(&id) {
                retained_bytes += content_bytes;
                continue;
            }

            if content_bytes > policy.max_session_bytes {
                self.trim_session_bodies(&id, policy.keep_message_bodies)?;
                report.trimmed_sessions.push(id.clone());
                retained_bytes += policy.keep_message_bodies.saturating_mul(2048);
                continue;
            }

            if now - updated_at < policy.min_age_ms {
                retained_bytes += content_bytes;
                continue;
            }

            if report.bytes_before - retained_bytes > policy.max_total_bytes {
                self.delete_agent_session(&id)?;
                report.dropped_sessions.push(id);
            } else {
                retained_bytes += content_bytes;
            }
        }

        self.vacuum()?;
        report.bytes_after = self.database_bytes()?;
        Ok(report)
    }

    /// Collapses the oldest message bodies to stubs, keeping the newest
    /// `keep` rows intact. Metadata (role, order, timestamp) always survives so
    /// the session still renders as a conversation.
    fn trim_session_bodies(&self, session_id: &str, keep: i64) -> Result<(), AppError> {
        self.conn
            .execute(
                "UPDATE agent_messages
                 SET content = json_object('trimmed', 1)
                 WHERE session_id = ?1
                   AND id IN (
                     SELECT id FROM agent_messages
                     WHERE session_id = ?1
                     ORDER BY seq DESC
                     LIMIT -1 OFFSET ?2
                   )",
                params![session_id, keep.max(0)],
            )
            .map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    /// Reclaims free pages. `incremental_vacuum` is a no-op unless the database
    /// was created with `auto_vacuum=INCREMENTAL`, which `HistoryDb::new` sets.
    pub fn vacuum(&self) -> Result<(), AppError> {
        self.conn
            .execute_batch("PRAGMA incremental_vacuum; PRAGMA optimize;")
            .map_err(|e| AppError::Db(e.to_string()))
    }
}

const SESSION_COLUMNS: &str = "id, project_id, title, title_source, summary, goal, first_prompt, \
     agent_type, agent_mode, model, status, message_count, pinned, archived, state, created_at, updated_at";

fn query_session(
    conn: &Connection,
    id: &str,
) -> Result<Option<AgentSessionRecord>, AppError> {
    conn.query_row(
        &format!("SELECT {SESSION_COLUMNS} FROM agent_sessions WHERE id = ?1"),
        [id],
        map_session,
    )
    .optional()
    .map_err(|e| AppError::Db(e.to_string()))
}

fn map_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSessionRecord> {
    Ok(AgentSessionRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        title_source: row.get(3)?,
        summary: row.get(4)?,
        goal: row.get(5)?,
        first_prompt: row.get(6)?,
        agent_type: row.get(7)?,
        agent_mode: row.get(8)?,
        model: row.get(9)?,
        status: row.get(10)?,
        message_count: row.get(11)?,
        pinned: row.get::<_, i64>(12)? != 0,
        archived: row.get::<_, i64>(13)? != 0,
        state: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

fn map_list_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSessionListItem> {
    Ok(AgentSessionListItem {
        session: map_session(row)?,
        preview: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> HistoryDb {
        let db = HistoryDb::new(None).unwrap();
        db
    }

    fn message(session: &str, seq: i64, text: &str) -> AgentMessageRecord {
        AgentMessageRecord {
            id: format!("{session}-m{seq}"),
            session_id: session.to_string(),
            seq,
            role: if seq % 2 == 1 { "user" } else { "assistant" }.to_string(),
            content: text.to_string(),
            created_at: seq,
        }
    }

    #[test]
    fn project_id_is_stable_and_case_insensitive() {
        let a = project_id_for("D:/Code/App");
        assert_eq!(a, project_id_for("d:\\code\\app\\"));
        assert_ne!(a, project_id_for("D:/Code/Other"));
    }

    #[test]
    fn upsert_creates_then_merges() {
        let db = db();
        let pid = project_id_for("/repo");
        db.upsert_agent_session(
            &AgentSessionPatch::new("s1", &pid).title("Fix login", TitleSource::Placeholder),
        )
        .unwrap();

        let updated = db
            .upsert_agent_session(
                &AgentSessionPatch::new("s1", &pid)
                    .title("Fix login flow", TitleSource::Model)
                    .status("executing")
                    .model(Some("gpt-5".into())),
            )
            .unwrap();

        assert_eq!(updated.title.as_deref(), Some("Fix login flow"));
        assert_eq!(updated.title_source, "model");
        assert_eq!(updated.status, "executing");
        assert_eq!(updated.agent_type, "developer");
    }

    #[test]
    fn manual_title_blocks_later_model_title() {
        let db = db();
        let pid = project_id_for("/repo");
        db.upsert_agent_session(
            &AgentSessionPatch::new("s1", &pid).title("User rename", TitleSource::Manual),
        )
        .unwrap();

        let after = db
            .upsert_agent_session(
                &AgentSessionPatch::new("s1", &pid).title("Model guess", TitleSource::Model),
            )
            .unwrap();

        assert_eq!(after.title.as_deref(), Some("User rename"));
        assert_eq!(after.title_source, "manual");
    }

    #[test]
    fn messages_replace_idempotently() {
        let db = db();
        let pid = project_id_for("/repo");
        db.upsert_agent_session(&AgentSessionPatch::new("s1", &pid))
            .unwrap();

        let history = vec![message("s1", 0, "hi"), message("s1", 1, "hello")];
        db.replace_agent_messages("s1", &history).unwrap();
        db.replace_agent_messages("s1", &history).unwrap();

        let stored = db.list_agent_messages("s1").unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[1].content, "hello");
        assert_eq!(db.get_agent_session("s1").unwrap().unwrap().message_count, 2);
    }

    #[test]
    fn list_is_project_scoped_and_pinned_first() {
        let db = db();
        let a = project_id_for("/a");
        let b = project_id_for("/b");
        db.upsert_agent_session(&AgentSessionPatch::new("a1", &a)).unwrap();
        db.upsert_agent_session(&AgentSessionPatch::new("a2", &a)).unwrap();
        db.upsert_agent_session(&AgentSessionPatch::new("b1", &b)).unwrap();
        db.set_agent_session_pinned("a2", true).unwrap();

        let list = db.list_agent_sessions(&a, false, 50).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].session.id, "a2");
        assert!(list[0].session.pinned);
    }

    #[test]
    fn delete_cascades_messages() {
        let db = db();
        let pid = project_id_for("/repo");
        db.upsert_agent_session(&AgentSessionPatch::new("s1", &pid)).unwrap();
        db.replace_agent_messages("s1", &[message("s1", 0, "hi")])
            .unwrap();

        db.delete_agent_session("s1").unwrap();
        assert!(db.get_agent_session("s1").unwrap().is_none());
        assert!(db.list_agent_messages("s1").unwrap().is_empty());
    }

    #[test]
    fn prune_drops_old_unpinned_but_spares_protected() {
        let db = db();
        let pid = project_id_for("/repo");
        let old = now_ms() - 40 * 24 * 60 * 60 * 1000;

        for id in ["old", "keep"] {
            db.upsert_agent_session(&AgentSessionPatch::new(id, &pid))
                .unwrap();
            db.replace_agent_messages(id, &[message(id, 0, "old content")])
                .unwrap();
            db.conn
                .execute(
                    "UPDATE agent_sessions SET updated_at = ?2 WHERE id = ?1",
                    params![id, old],
                )
                .unwrap();
        }

        let policy = RetentionPolicy::builder().max_total_bytes(1).build();
        let protect: HashSet<String> = ["keep".to_string()].into_iter().collect();
        let report = db.prune_agent_sessions(&policy, &protect).unwrap();

        assert_eq!(report.dropped_sessions, vec!["old".to_string()]);
        assert!(db.get_agent_session("keep").unwrap().is_some());
    }

    #[test]
    fn oversized_session_is_trimmed_not_dropped() {
        let db = db();
        let pid = project_id_for("/repo");
        db.upsert_agent_session(&AgentSessionPatch::new("big", &pid))
            .unwrap();

        let history: Vec<AgentMessageRecord> = (0..40)
            .map(|i| message("big", i, &"x".repeat(500)))
            .collect();
        db.replace_agent_messages("big", &history).unwrap();

        let policy = RetentionPolicy::builder()
            .max_session_bytes(1024)
            .keep_message_bodies(5)
            .build();
        let report = db
            .prune_agent_sessions(&policy, &HashSet::new())
            .unwrap();

        assert_eq!(report.trimmed_sessions, vec!["big".to_string()]);
        let stored = db.list_agent_messages("big").unwrap();
        assert_eq!(stored.len(), 40);
        assert!(stored[0].content.contains("trimmed"));
        assert_eq!(stored[39].content.len(), 500);
    }

    /// The frontend types in `packages/types/src/agentSession.ts` are a
    /// hand-written mirror of these structs, so a rename on either side is a
    /// silent runtime bug. This pins the exact wire field names.
    #[test]
    fn wire_format_matches_frontend_types() {
        let record = AgentSessionRecord {
            id: "s1".into(),
            project_id: "p1".into(),
            title: Some("Fix login".into()),
            title_source: "model".into(),
            summary: None,
            goal: Some("fix login".into()),
            first_prompt: Some("fix login".into()),
            agent_type: "developer".into(),
            agent_mode: "build".into(),
            model: None,
            status: "completed".into(),
            message_count: 2,
            pinned: true,
            archived: false,
            state: "{}".into(),
            created_at: 1,
            updated_at: 2,
        };

        let value: serde_json::Value =
            serde_json::to_value(&record).expect("record serializes");
        for field in [
            "id",
            "projectId",
            "title",
            "titleSource",
            "summary",
            "goal",
            "firstPrompt",
            "agentType",
            "agentMode",
            "model",
            "status",
            "messageCount",
            "pinned",
            "archived",
            "state",
            "createdAt",
            "updatedAt",
        ] {
            assert!(value.get(field).is_some(), "missing wire field `{field}`");
        }
        assert_eq!(value["pinned"], serde_json::json!(true));

        let msg: serde_json::Value = serde_json::to_value(message("s1", 3, "hi")).unwrap();
        for field in ["id", "sessionId", "seq", "role", "content", "createdAt"] {
            assert!(msg.get(field).is_some(), "missing message field `{field}`");
        }

        let report: serde_json::Value =
            serde_json::to_value(PruneReport::default()).unwrap();
        for field in ["droppedSessions", "trimmedSessions", "bytesBefore", "bytesAfter"] {
            assert!(report.get(field).is_some(), "missing report field `{field}`");
        }

        let stats: serde_json::Value =
            serde_json::to_value(AgentStorageStats::default()).unwrap();
        for field in ["sessions", "projects", "bytes"] {
            assert!(stats.get(field).is_some(), "missing stats field `{field}`");
        }
    }

    #[test]
    fn patch_tolerates_a_sparse_payload() {
        // The frontend sends partial patches, so a status-only update must not
        // blank out a title that is already stored.
        let db = db();
        let pid = project_id_for("/repo");
        db.upsert_agent_session(
            &AgentSessionPatch::new("s1", &pid).title("Fix login", TitleSource::Manual),
        )
        .unwrap();

        let updated = db
            .upsert_agent_session(
                &AgentSessionPatch::new("s1", &pid).status("executing"),
            )
            .unwrap();

        assert_eq!(updated.title.as_deref(), Some("Fix login"));
        assert_eq!(updated.title_source, "manual");
        assert_eq!(updated.status, "executing");
    }
}
