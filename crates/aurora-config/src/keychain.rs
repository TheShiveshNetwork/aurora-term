use aurora_core::AppError;
use keyring::Entry;

const SERVICE_NAME: &str = "aurora-term";

pub struct KeychainManager;

impl KeychainManager {
    /// Save an API key to the OS keychain.
    pub fn save_api_key(provider: &str, key: &str) -> Result<(), AppError> {
        Self::save_secret(&format!("{}_api_key", provider), key)
    }

    /// Delete an API key from the OS keychain.
    pub fn delete_api_key(provider: &str) -> Result<(), AppError> {
        Self::delete_secret(&format!("{}_api_key", provider))
    }

    /// Get an API key from the OS keychain.
    pub fn get_api_key(provider: &str) -> Result<String, AppError> {
        Self::get_secret(&format!("{}_api_key", provider))
    }

    /// Check if an API key exists in the keychain.
    pub fn has_api_key(provider: &str) -> bool {
        Self::has_secret(&format!("{}_api_key", provider))
    }

    /// Save an arbitrary secret (e.g. the cloud session token) to the OS
    /// keychain under the `aurora-term` service.
    pub fn save_secret(account: &str, secret: &str) -> Result<(), AppError> {
        let entry = Entry::new(SERVICE_NAME, account)
            .map_err(|e| AppError::Config(format!("Keyring error: {}", e)))?;
        entry.set_password(secret)
            .map_err(|e| AppError::Config(format!("Failed to save secret to keyring: {}", e)))?;
        Ok(())
    }

    /// Delete an arbitrary secret from the OS keychain.
    pub fn delete_secret(account: &str) -> Result<(), AppError> {
        let entry = Entry::new(SERVICE_NAME, account)
            .map_err(|e| AppError::Config(format!("Keyring error: {}", e)))?;
        let _ = entry.delete_password();
        Ok(())
    }

    /// Get an arbitrary secret from the OS keychain.
    pub fn get_secret(account: &str) -> Result<String, AppError> {
        let entry = Entry::new(SERVICE_NAME, account)
            .map_err(|e| AppError::Config(format!("Keychain access error: {}", e)))?;
        entry.get_password()
            .map_err(|e| AppError::Config(format!("Keychain read error: {}", e)))
    }

    /// Check if a secret exists in the keychain.
    pub fn has_secret(account: &str) -> bool {
        Self::get_secret(account).is_ok()
    }
}
