use base64::Engine;
use rand::distributions::Alphanumeric;
use rand::Rng;
use sha2::{Digest, Sha256};

use aurora_core::AppError;

use crate::client::{AuthResponse, CloudClient};
use crate::session::SessionStore;

/// PKCE OAuth flow with a localhost loopback redirect.
///
/// 1. Start a `tiny_http` server on a random `127.0.0.1` port.
/// 2. Ask the backend for a Supabase authorize URL (it builds the PKCE URL
///    server-side; the app generates the verifier/challenge pair).
/// 3. Open the browser, wait for the `{port}/oauth/callback?code=...`.
/// 4. Exchange the code with the backend, store the opaque session token.
///
/// Returns the signed-in user's email.
pub async fn run_oauth_flow(client: &CloudClient, provider: &str) -> Result<String, AppError> {
    if !client.is_enabled() {
        return Err(AppError::Cloud(
            "Cloud sync is not configured (no API base URL)".to_string(),
        ));
    }

    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| AppError::Cloud(format!("Failed to start local auth server: {}", e)))?;

    let port = match server.server_addr() {
        tiny_http::ListenAddr::IP(addr) => addr.port(),
    };
    let redirect_uri = format!("http://127.0.0.1:{}/oauth/callback", port);

    let verifier = generate_verifier();
    let challenge = code_challenge(&verifier)?;

    let start = client
        .start_oauth(provider, &redirect_uri, &challenge)
        .await?;

    webbrowser::open(&start.authorize_url)
        .map_err(|e| AppError::Cloud(format!("Failed to open browser: {}", e)))?;

    // Wait for the browser redirect in a blocking task (tiny_http::Server is
    // synchronous). Anything that isn't our callback is answered with 200 and
    // ignored so the browser doesn't hang.
    let (code_tx, code_rx) = tokio::sync::oneshot::channel::<String>();
    let server_task = tokio::task::spawn_blocking(move || {
        loop {
            match server.recv() {
                Ok(request) => {
                    let url = request.url().to_string();
                    let is_callback = url.starts_with("/oauth/callback");
                    let body = if is_callback {
                        "<html><body style=\"font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h2>Signed in to Aurora</h2><p>You can close this window and return to the app.</p></div></body></html>".to_string()
                    } else {
                        "Aurora auth".to_string()
                    };
                    let _ = request.respond(tiny_http::Response::from_string(body));
                    if is_callback {
                        let error = extract_param(&url, "error");
                        let code = if error.is_empty() {
                            extract_param(&url, "code")
                        } else {
                            String::new()
                        };
                        let _ = code_tx.send(code);
                        break;
                    }
                }
                Err(_) => {
                    let _ = code_tx.send(String::new());
                    break;
                }
            }
        }
    });

    let code = code_rx
        .await
        .map_err(|_| AppError::Cloud("Auth callback interrupted".to_string()))?;
    let _ = server_task.await;

    if code.is_empty() {
        return Err(AppError::Cloud(
            "OAuth sign-in was cancelled or failed".to_string(),
        ));
    }

    let auth: AuthResponse = client
        .exchange_oauth(&code, &verifier, &redirect_uri)
        .await?;
    SessionStore::save_session(&auth.token, &auth.email)?;
    Ok(auth.email)
}

fn generate_verifier() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect()
}

fn code_challenge(verifier: &str) -> Result<String, AppError> {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let digest = hasher.finalize();
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest))
}

fn extract_param(url: &str, key: &str) -> String {
    let Some(idx) = url.find('?') else {
        return String::new();
    };
    for part in url[idx + 1..].split('&') {
        if let Some((k, v)) = part.split_once('=') {
            if k == key {
                return percent_decode(v);
            }
        }
    }
    String::new()
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(b) = u8::from_str_radix(hex, 16) {
                    out.push(b);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
