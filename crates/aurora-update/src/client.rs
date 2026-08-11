use aurora_cloud::CloudClient;
use aurora_core::types::sync::{UpdateInfo, UpdateStatus};
use aurora_core::AppError;
use semver::Version;

/// Checks for updates against the backend's GitHub Releases proxy.
/// The current version always comes from `app.package_info().version`
/// (single source of truth) — never a hardcoded string.
pub struct UpdateClient {
    client: CloudClient,
}

impl UpdateClient {
    pub fn new(base_url: String) -> Self {
        Self {
            client: CloudClient::new(base_url),
        }
    }

    pub fn set_base_url(&mut self, base_url: String) {
        self.client = CloudClient::new(base_url);
    }

    pub async fn check(&self, current_version: &str) -> Result<UpdateInfo, AppError> {
        if !self.client.is_enabled() {
            return Ok(Self::disabled(current_version));
        }

        let Some(doc) = self.client.update_latest().await? else {
            return Ok(UpdateInfo {
                status: UpdateStatus::UpToDate,
                available: false,
                current_version: current_version.to_string(),
                latest_version: current_version.to_string(),
                url: None,
                notes: None,
                published_at: None,
                dismissed: false,
            });
        };

        let current = Version::parse(current_version).ok();
        let latest = Version::parse(&doc.version).ok();

        let available = match (current, latest) {
            (Some(c), Some(l)) => {
                // Never suggest a prerelease to a user on a stable build.
                let current_is_pre = !c.pre.is_empty();
                let latest_is_pre = !l.pre.is_empty();
                let allowed = current_is_pre || !latest_is_pre;
                allowed && l > c
            }
            _ => false,
        };

        Ok(UpdateInfo {
            status: if available {
                UpdateStatus::Available
            } else {
                UpdateStatus::UpToDate
            },
            available,
            current_version: current_version.to_string(),
            latest_version: doc.version,
            url: doc.url,
            notes: doc.notes,
            published_at: doc.published_at,
            dismissed: false,
        })
    }

    fn disabled(current_version: &str) -> UpdateInfo {
        UpdateInfo {
            status: UpdateStatus::Disabled,
            available: false,
            current_version: current_version.to_string(),
            latest_version: current_version.to_string(),
            url: None,
            notes: None,
            published_at: None,
            dismissed: false,
        }
    }
}
