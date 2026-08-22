use serde::{Deserialize, Serialize};

/// Authentication status surfaced to the frontend. Never includes the
/// session token — only whether a session exists and the user's email.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AuthStatus {
    pub signed_in: bool,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    /// Local and cloud are identical.
    Synced,
    /// Local changes were written to the cloud.
    Pushed,
    /// Cloud changes were adopted locally.
    Pulled,
    /// Concurrent edits detected — the frontend must show the 3-way dialog.
    Conflict,
    /// No active session token.
    SignedOut,
    /// No API base URL configured.
    Disabled,
}

/// Result of a sync attempt. `remote_payload` carries the current cloud
/// `AppConfig` JSON (used by Pulled and Conflict resolutions).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SyncResult {
    pub status: SyncStatus,
    pub remote_payload: Option<serde_json::Value>,
    pub remote_version: Option<String>,
    pub remote_updated_at: Option<String>,
}

/// 3-way conflict resolution choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncAction {
    KeepLocal,
    KeepCloud,
    Merge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStatus {
    Available,
    UpToDate,
    Disabled,
    Failed,
}

/// Result of an update check. `available` is a convenience flag derived from
/// `status == Available` plus the dismissed check on the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UpdateInfo {
    pub status: UpdateStatus,
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    pub dismissed: bool,
}
