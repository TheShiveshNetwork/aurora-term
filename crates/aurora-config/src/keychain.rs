use aurora_core::AppError;
use keyring::Entry;

const SERVICE_NAME: &str = "aurora-term";

pub struct KeychainManager;

impl KeychainManager {
    /// Save an API key to the OS keychain.
    pub fn save_api_key(provider: &str, key: &str) -> Result<(), AppError> {
        let key_name = format!("{}_api_key", provider);
        let entry = Entry::new(SERVICE_NAME, &key_name)
            .map_err(|e| AppError::Config(format!("Keyring error: {}", e)))?;
        entry.set_password(key)
            .map_err(|e| AppError::Config(format!("Failed to save API key to keyring: {}", e)))?;
        Ok(())
    }

    /// Delete an API key from the OS keychain.
    pub fn delete_api_key(provider: &str) -> Result<(), AppError> {
        let key_name = format!("{}_api_key", provider);
        let entry = Entry::new(SERVICE_NAME, &key_name)
            .map_err(|e| AppError::Config(format!("Keyring error: {}", e)))?;
        let _ = entry.delete_password();
        Ok(())
    }

    /// Get an API key from the OS keychain. Returns empty string if not found.
    pub fn get_api_key(provider: &str) -> Result<String, AppError> {
        let key_name = format!("{}_api_key", provider);
        let entry = Entry::new(SERVICE_NAME, &key_name)
            .map_err(|e| AppError::Config(format!("Keyring error: {}", e)))?;
        Ok(entry.get_password().unwrap_or_default())
    }

    /// Check if an API key exists in the keychain.
    pub fn has_api_key(provider: &str) -> bool {
        let key_name = format!("{}_api_key", provider);
        if let Ok(entry) = Entry::new(SERVICE_NAME, &key_name) {
            entry.get_password().is_ok()
        } else {
            false
        }
    }
}
