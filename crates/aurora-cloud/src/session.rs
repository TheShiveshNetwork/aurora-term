use aurora_config::KeychainManager;
use aurora_core::AppError;
use aurora_core::types::sync::AuthStatus;

/// Opaque session token + email stored in the OS keychain.
/// The token is meaningless outside our backend — it is NOT a Supabase key.
const ACCOUNT_TOKEN: &str = "aurora_cloud_session";
const ACCOUNT_EMAIL: &str = "aurora_cloud_email";

pub struct SessionStore;

impl SessionStore {
    pub fn load_token() -> Option<String> {
        KeychainManager::get_secret(ACCOUNT_TOKEN).ok()
    }

    pub fn save_session(token: &str, email: &str) -> Result<(), AppError> {
        KeychainManager::save_secret(ACCOUNT_TOKEN, token)?;
        KeychainManager::save_secret(ACCOUNT_EMAIL, email)?;
        Ok(())
    }

    pub fn clear_session() {
        let _ = KeychainManager::delete_secret(ACCOUNT_TOKEN);
        let _ = KeychainManager::delete_secret(ACCOUNT_EMAIL);
    }

    pub fn auth_status() -> AuthStatus {
        let email = KeychainManager::get_secret(ACCOUNT_EMAIL).ok();
        AuthStatus {
            signed_in: Self::load_token().is_some(),
            email,
        }
    }
}
