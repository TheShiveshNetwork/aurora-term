use reqwest::Client;
use std::time::Duration;


pub struct AiHttpClient {
    pub client: Client,
}

impl AiHttpClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();

        Self { client }
    }
}

pub struct SseLineReader {
    pub buffer: Vec<u8>,
}

impl SseLineReader {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    /// Read incoming bytes and search for complete SSE lines (terminated by '\n').
    /// Returns the parsed lines.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(bytes);
        let mut lines = Vec::new();
        
        while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let line_bytes = self.buffer.drain(..pos + 1).collect::<Vec<u8>>();
            let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
            if !line.is_empty() {
                lines.push(line);
            }
        }
        
        lines
    }
}
