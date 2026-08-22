use aurora_core::AppError;
use serde::de::DeserializeOwned;

/// HTTP client for the Aurora backend (a Supabase Edge Function). All
/// endpoints are relative to a configurable `api_base_url`.
pub struct CloudClient {
    base_url: String,
    http: reqwest::Client,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub token: String,
    pub email: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStartResponse {
    pub authorize_url: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDoc {
    pub version: String,
    pub updated_at: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDoc {
    pub version: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub published_at: Option<String>,
}

/// Outcome of a compare-and-swap push.
#[derive(Debug)]
pub enum PushOutcome {
    /// The server accepted the write and returned the stored document.
    Saved(SyncDoc),
    /// The server's version moved on since `base_version` — concurrent edit.
    Conflict(SyncDoc),
}

impl CloudClient {
    pub fn new(base_url: String) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn is_enabled(&self) -> bool {
        !self.base_url.is_empty()
    }

    // ── Auth ────────────────────────────────────────────────

    pub async fn sign_in_password(
        &self,
        email: &str,
        password: &str,
    ) -> Result<AuthResponse, AppError> {
        self.post_json(
            "/v1/auth/password",
            None,
            &serde_json::json!({ "email": email, "password": password }),
        )
        .await
    }

    pub async fn start_oauth(
        &self,
        provider: &str,
        redirect_uri: &str,
        code_challenge: &str,
    ) -> Result<OAuthStartResponse, AppError> {
        self.post_json(
            "/v1/auth/start-oauth",
            None,
            &serde_json::json!({
                "provider": provider,
                "redirect_uri": redirect_uri,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }),
        )
        .await
    }

    pub async fn exchange_oauth(
        &self,
        code: &str,
        code_verifier: &str,
        redirect_uri: &str,
    ) -> Result<AuthResponse, AppError> {
        self.post_json(
            "/v1/auth/oauth-exchange",
            None,
            &serde_json::json!({
                "code": code,
                "code_verifier": code_verifier,
                "redirect_uri": redirect_uri,
            }),
        )
        .await
    }

    pub async fn logout(&self, token: &str) -> Result<(), AppError> {
        self.post_json::<serde_json::Value>("/v1/auth/logout", Some(token), &serde_json::json!({}))
            .await
            .map(|_| ())
    }

    // ── Sync ────────────────────────────────────────────────

    /// Fetch the current sync document. `Ok(None)` when nothing is stored.
    pub async fn get_sync(&self, token: &str) -> Result<Option<SyncDoc>, AppError> {
        let resp = self
            .http
            .get(format!("{}/v1/sync", self.base_url))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| AppError::Cloud(format!("Sync request failed: {}", e)))?;
        match resp.status().as_u16() {
            200 => Ok(Some(
                resp.json()
                    .await
                    .map_err(|e| AppError::Cloud(format!("Bad sync response: {}", e)))?,
            )),
            404 => Ok(None),
            401 => Err(AppError::Cloud("Unauthorized".to_string())),
            s => Err(AppError::Cloud(format!("Unexpected status {}", s))),
        }
    }

    /// Compare-and-swap push. `base_version` is `None` for a first write.
    pub async fn push_sync(
        &self,
        token: &str,
        payload: &serde_json::Value,
        version: &str,
        base_version: Option<&str>,
    ) -> Result<PushOutcome, AppError> {
        let body = serde_json::json!({
            "payload": payload,
            "version": version,
            "base_version": base_version,
        });
        let resp = self
            .http
            .post(format!("{}/v1/sync", self.base_url))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Cloud(format!("Sync request failed: {}", e)))?;
        match resp.status().as_u16() {
            200 => Ok(PushOutcome::Saved(
                resp.json()
                    .await
                    .map_err(|e| AppError::Cloud(format!("Bad sync response: {}", e)))?,
            )),
            409 => Ok(PushOutcome::Conflict(
                resp.json()
                    .await
                    .map_err(|e| AppError::Cloud(format!("Bad conflict response: {}", e)))?,
            )),
            401 => Err(AppError::Cloud("Unauthorized".to_string())),
            s => Err(AppError::Cloud(format!("Unexpected status {}", s))),
        }
    }

    // ── Updates ─────────────────────────────────────────────

    /// Latest release info proxied from GitHub Releases by the backend.
    pub async fn update_latest(&self) -> Result<Option<UpdateDoc>, AppError> {
        let resp = self
            .http
            .get(format!("{}/v1/update/latest", self.base_url))
            .send()
            .await
            .map_err(|e| AppError::Update(format!("Update request failed: {}", e)))?;
        match resp.status().as_u16() {
            200 => Ok(Some(
                resp.json()
                    .await
                    .map_err(|e| AppError::Update(format!("Bad update response: {}", e)))?,
            )),
            404 => Ok(None),
            s => Err(AppError::Update(format!("Unexpected status {}", s))),
        }
    }

    // ── Helpers ─────────────────────────────────────────────

    async fn post_json<R: DeserializeOwned>(
        &self,
        path: &str,
        token: Option<&str>,
        body: &serde_json::Value,
    ) -> Result<R, AppError> {
        let mut req = self.http.post(format!("{}{}", self.base_url, path));
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        let resp = req
            .json(body)
            .send()
            .await
            .map_err(|e| AppError::Cloud(format!("Request failed: {}", e)))?;
        match resp.status().as_u16() {
            200 => resp
                .json()
                .await
                .map_err(|e| AppError::Cloud(format!("Bad response: {}", e))),
            401 => Err(AppError::Cloud("Unauthorized".to_string())),
            s => {
                let text = resp.text().await.unwrap_or_default();
                Err(AppError::Cloud(format!("{}: {}", s, text)))
            }
        }
    }
}
