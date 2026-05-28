pub mod client;
pub mod prompts;
pub mod router;
pub mod providers;

pub use client::AiHttpClient;
pub use router::{AiRouter, AiTask, classify_task};
pub use providers::AiProvider;
