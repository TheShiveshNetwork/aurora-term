use std::env;
use std::io::{Read, Write};
use std::net::TcpListener;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct StepRequest {
    task_id: String,
    goal: Option<String>,
    last_output: Option<String>,
    exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
struct StepResponse {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    explanation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let port = args.iter()
        .position(|arg| arg == "--port")
        .and_then(|idx| args.get(idx + 1))
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(4096);

    let address = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&address).expect("Failed to bind mock server");
    println!("Mock OpenCode server listening on http://{}", address);

    for stream in listener.incoming() {
        let mut stream = match stream {
            Ok(s) => s,
            Err(_) => continue,
        };

        let mut buffer = [0; 8192];
        let bytes_read = match stream.read(&mut buffer) {
            Ok(n) if n > 0 => n,
            _ => continue,
        };

        let request = String::from_utf8_lossy(&buffer[..bytes_read]);
        let mut lines = request.lines();
        let request_line = match lines.next() {
            Some(rl) => rl,
            None => continue,
        };

        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("GET");
        let path = parts.next().unwrap_or("/");

        if path == "/health" {
            let response_body = "{\"status\":\"ok\"}";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            let _ = stream.write_all(response.as_bytes());
        } else if path == "/api/step" && method == "POST" {
            // Find body start
            if let Some(body_start) = request.find("\r\n\r\n") {
                let body = &request[body_start + 4..];
                if let Ok(req_data) = serde_json::from_str::<StepRequest>(body.trim()) {
                    let response_data = handle_step(req_data);
                    let response_body = serde_json::to_string(&response_data).unwrap();
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        response_body.len(),
                        response_body
                    );
                    let _ = stream.write_all(response.as_bytes());
                } else {
                    let response = "HTTP/1.1 400 BAD REQUEST\r\nConnection: close\r\n\r\n";
                    let _ = stream.write_all(response.as_bytes());
                }
            }
        } else {
            let response = "HTTP/1.1 404 NOT FOUND\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(response.as_bytes());
        }
        let _ = stream.flush();
    }
}

fn handle_step(req: StepRequest) -> StepResponse {
    // Basic state machine logic based on command response context
    if req.goal.is_some() {
        // Step 1: Start execution with a read-only command (safe)
        StepResponse {
            status: "executing".to_string(),
            command: Some("git status".to_string()),
            explanation: Some("Checking the git repository status to see modified files.".to_string()),
            message: None,
        }
    } else if let Some(last_output) = req.last_output {
        if last_output.contains("On branch") || last_output.contains("working tree clean") || last_output.contains("Changes not staged") {
            // Step 2: Run a write/update command that requires confirmation (to test the safety confirmation flow)
            StepResponse {
                status: "executing".to_string(),
                command: Some("echo 'Running write update task...' > opencode_test_file.txt".to_string()),
                explanation: Some("Writing test verification content to a local file. This requires your approval as it is a file write operation.".to_string()),
                message: None,
            }
        } else if last_output.contains("Running write update task") || last_output.is_empty() {
            // Step 3: Complete task
            StepResponse {
                status: "completed".to_string(),
                command: None,
                explanation: None,
                message: Some("OpenCode mock task executed successfully! Verifying the output file writes.".to_string()),
            }
        } else {
            // Fallback complete
            StepResponse {
                status: "completed".to_string(),
                command: None,
                explanation: None,
                message: Some("Task finished successfully.".to_string()),
            }
        }
    } else {
        StepResponse {
            status: "completed".to_string(),
            command: None,
            explanation: None,
            message: Some("Task finished successfully.".to_string()),
        }
    }
}
