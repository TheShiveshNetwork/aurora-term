use sha2::{Digest, Sha256};

use aurora_config::manager::deep_merge_raw;
use aurora_config::ConfigManager;
use aurora_core::config::AppConfig;
use aurora_core::types::sync::{SyncAction, SyncResult, SyncStatus};
use aurora_core::AppError;

use crate::client::{CloudClient, PushOutcome};
use crate::session::SessionStore;

/// Last-writer-wins sync with compare-and-swap conflict detection.
///
/// Content is identified by a SHA-256 of the canonicalized `AppConfig` JSON.
/// The server stores a single document per user; a push carries the expected
/// base version so concurrent edits surface as a 3-way conflict instead of
/// silently clobbering each other.
pub struct SyncManager {
    client: CloudClient,
}

impl SyncManager {
    pub fn new(base_url: String) -> Self {
        Self {
            client: CloudClient::new(base_url),
        }
    }

    pub fn set_base_url(&mut self, base_url: String) {
        self.client = CloudClient::new(base_url);
    }

    /// Push-or-pull reconciliation of the given local config.
    pub async fn sync_now(&self, config: &AppConfig) -> Result<SyncResult, AppError> {
        if !self.client.is_enabled() {
            return Ok(Self::result(SyncStatus::Disabled, None));
        }
        let Some(token) = SessionStore::load_token() else {
            return Ok(Self::result(SyncStatus::SignedOut, None));
        };

        let payload = serde_json::to_value(config)
            .map_err(|e| AppError::Cloud(format!("Serialization error: {}", e)))?;
        let version = content_hash(&payload)?;

        let remote = match self.client.get_sync(&token).await {
            Ok(remote) => remote,
            Err(e) if is_unauthorized(&e) => return Ok(Self::result(SyncStatus::SignedOut, None)),
            Err(e) => return Err(e),
        };

        match remote {
            // No remote document: seed it with the local config.
            None => self.push(&token, &payload, &version, None).await,
            Some(doc) => {
                if doc.version == version {
                    return Ok(Self::synced(&doc));
                }
                // Try to advance the cloud to our version, assuming the
                // document we just fetched is still current.
                self.push(&token, &payload, &version, Some(&doc.version)).await
            }
        }
    }

    /// Resolve a previously surfaced conflict.
    pub async fn resolve_conflict(
        &self,
        config: &AppConfig,
        remote_version: &str,
        action: SyncAction,
    ) -> Result<SyncResult, AppError> {
        if !self.client.is_enabled() {
            return Ok(Self::result(SyncStatus::Disabled, None));
        }
        let Some(token) = SessionStore::load_token() else {
            return Ok(Self::result(SyncStatus::SignedOut, None));
        };

        match action {
            // Overwrite the cloud with the local config (CAS against the
            // version we observed, so the write is accepted).
            SyncAction::KeepLocal => {
                let payload = serde_json::to_value(config)
                    .map_err(|e| AppError::Cloud(format!("Serialization error: {}", e)))?;
                let version = content_hash(&payload)?;
                self.push(&token, &payload, &version, Some(remote_version))
                    .await
            }
            // Adopt the cloud config wholesale.
            SyncAction::KeepCloud => {
                let doc = self
                    .client
                    .get_sync(&token)
                    .await
                    .map_err(|e| {
                        if is_unauthorized(&e) {
                            AppError::Cloud("Unauthorized".to_string())
                        } else {
                            e
                        }
                    })?
                    .ok_or_else(|| AppError::Cloud("No cloud config to adopt".to_string()))?;
                Ok(SyncResult {
                    status: SyncStatus::Pulled,
                    remote_payload: Some(doc.payload),
                    remote_version: Some(doc.version),
                    remote_updated_at: Some(doc.updated_at),
                })
            }
            // Merge remote over local via the shared deep-merge, then push.
            SyncAction::Merge => {
                let doc = self
                    .client
                    .get_sync(&token)
                    .await
                    .map_err(|e| {
                        if is_unauthorized(&e) {
                            AppError::Cloud("Unauthorized".to_string())
                        } else {
                            e
                        }
                    })?
                    .ok_or_else(|| AppError::Cloud("No cloud config to merge".to_string()))?;
                let mut local_v = serde_json::to_value(config)
                    .map_err(|e| AppError::Cloud(format!("Serialization error: {}", e)))?;
                deep_merge_raw(&mut local_v, &doc.payload);
                let version = content_hash(&local_v)?;
                self.push(&token, &local_v, &version, Some(remote_version))
                    .await
            }
        }
    }

    /// Persist a remote payload as the global config via `ConfigManager`.
    /// Uses `save_global()` directly — never the IPC command (which restarts
    /// the sidecar).
    pub fn apply_payload(
        config_manager: &mut ConfigManager,
        payload: &serde_json::Value,
    ) -> Result<(), AppError> {
        let config: AppConfig = serde_json::from_value(payload.clone())
            .map_err(|e| AppError::Cloud(format!("Bad remote config: {}", e)))?;
        config_manager.save_global(&config)?;
        Ok(())
    }

    async fn push(
        &self,
        token: &str,
        payload: &serde_json::Value,
        version: &str,
        base_version: Option<&str>,
    ) -> Result<SyncResult, AppError> {
        match self
            .client
            .push_sync(token, payload, version, base_version)
            .await
        {
            Ok(PushOutcome::Saved(doc)) => Ok(SyncResult {
                status: SyncStatus::Pushed,
                remote_payload: Some(doc.payload),
                remote_version: Some(doc.version),
                remote_updated_at: Some(doc.updated_at),
            }),
            Ok(PushOutcome::Conflict(doc)) => Ok(SyncResult {
                status: SyncStatus::Conflict,
                remote_payload: Some(doc.payload),
                remote_version: Some(doc.version),
                remote_updated_at: Some(doc.updated_at),
            }),
            Err(e) if is_unauthorized(&e) => Ok(Self::result(SyncStatus::SignedOut, None)),
            Err(e) => Err(e),
        }
    }

    fn synced(doc: &crate::client::SyncDoc) -> SyncResult {
        SyncResult {
            status: SyncStatus::Synced,
            remote_payload: Some(doc.payload.clone()),
            remote_version: Some(doc.version.clone()),
            remote_updated_at: Some(doc.updated_at.clone()),
        }
    }

    fn result(status: SyncStatus, version: Option<String>) -> SyncResult {
        SyncResult {
            status,
            remote_payload: None,
            remote_version: version,
            remote_updated_at: None,
        }
    }
}

fn is_unauthorized(e: &AppError) -> bool {
    match e {
        AppError::Cloud(m) => m == "Unauthorized",
        _ => false,
    }
}

fn content_hash(payload: &serde_json::Value) -> Result<String, AppError> {
    let canonical = canonical_json(payload)?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect())
}

/// Serialize with recursively sorted object keys so the hash is stable
/// regardless of field insertion order.
fn canonical_json(value: &serde_json::Value) -> Result<String, AppError> {
    let sorted = sort_value(value);
    serde_json::to_string(&sorted)
        .map_err(|e| AppError::Cloud(format!("Serialize error: {}", e)))
}

fn sort_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut sorted = serde_json::Map::new();
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for k in keys {
                sorted.insert(k.clone(), sort_value(&map[k]));
            }
            serde_json::Value::Object(sorted)
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(sort_value).collect())
        }
        other => other.clone(),
    }
}
