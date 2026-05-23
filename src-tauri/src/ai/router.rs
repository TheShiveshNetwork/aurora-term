use serde::{Deserialize, Serialize};
use crate::error::AppError;
use crate::ai::providers::{AiMessage, AiProvider};
use crate::ai::prompts::{
    TRANSLATE_COMMAND_SYSTEM, EXPLAIN_ERROR_SYSTEM, AUTOCOMPLETE_SYSTEM, WORKFLOW_SYSTEM
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum TaskTier {
    Fast,
    Balanced,
    Powerful,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AiTask {
    Autocomplete {
        partial_command: String,
        context: String,
    },
    InlineFix {
        command: String,
        error_output: String,
    },
    TranslateCommand {
        query: String,
        context: String,
    },
    ExplainError {
        command: String,
        output: String,
        output_len: usize,
        exit_code: i32,
    },
    GenerateWorkflow {
        goal: String,
        context: String,
    },
    DeepDiagnosis {
        command: String,
        output: String,
        exit_code: i32,
    },
}

impl AiTask {
    pub fn into_messages(self) -> Vec<AiMessage> {
        match self {
            AiTask::Autocomplete { partial_command, context } => {
                vec![
                    AiMessage {
                        role: "system".to_string(),
                        content: AUTOCOMPLETE_SYSTEM.to_string(),
                    },
                    AiMessage {
                        role: "user".to_string(),
                        content: format!("Context: {}\nPartial Command: {}", context, partial_command),
                    },
                ]
            }
            AiTask::InlineFix { command, error_output } => {
                vec![
                    AiMessage {
                        role: "system".to_string(),
                        content: "You are a shell assistant. Fix this syntax error or typo in the command.".to_string(),
                    },
                    AiMessage {
                        role: "user".to_string(),
                        content: format!("Command: {}\nError: {}", command, error_output),
                    },
                ]
            }
            AiTask::TranslateCommand { query, context } => {
                vec![
                    AiMessage {
                        role: "system".to_string(),
                        content: TRANSLATE_COMMAND_SYSTEM.to_string(),
                    },
                    AiMessage {
                        role: "user".to_string(),
                        content: format!("Context: {}\nDescription: {}", context, query),
                    },
                ]
            }
            AiTask::ExplainError { command, output, exit_code, .. } => {
                vec![
                    AiMessage {
                        role: "system".to_string(),
                        content: EXPLAIN_ERROR_SYSTEM.to_string(),
                    },
                    AiMessage {
                        role: "user".to_string(),
                        content: format!(
                            "Command: {}\nExit Code: {}\nOutput: {}",
                            command, exit_code, output
                        ),
                    },
                ]
            }
            AiTask::GenerateWorkflow { goal, context } => {
                vec![
                    AiMessage {
                        role: "system".to_string(),
                        content: WORKFLOW_SYSTEM.to_string(),
                    },
                    AiMessage {
                        role: "user".to_string(),
                        content: format!("Context: {}\nGoal: {}", context, goal),
                    },
                ]
            }
            AiTask::DeepDiagnosis { command, output, exit_code } => {
                vec![
                    AiMessage {
                        role: "system".to_string(),
                        content: "Provide a comprehensive, multi-step troubleshooting diagnosis for this shell command error.".to_string(),
                    },
                    AiMessage {
                        role: "user".to_string(),
                        content: format!(
                            "Command: {}\nExit Code: {}\nOutput: {}",
                            command, exit_code, output
                        ),
                    },
                ]
            }
        }
    }
}

pub fn classify_task(task: &AiTask) -> TaskTier {
    match task {
        AiTask::Autocomplete { .. } => TaskTier::Fast,
        AiTask::InlineFix { .. } => TaskTier::Fast,
        AiTask::TranslateCommand { .. } => TaskTier::Balanced,
        AiTask::ExplainError { output_len, .. } if *output_len < 500 => TaskTier::Balanced,
        AiTask::ExplainError { .. } => TaskTier::Powerful,
        AiTask::GenerateWorkflow { .. } => TaskTier::Powerful,
        AiTask::DeepDiagnosis { .. } => TaskTier::Powerful,
    }
}

pub struct AiRouter {
    pub provider: Box<dyn AiProvider>,
}

impl AiRouter {
    pub fn new(provider: Box<dyn AiProvider>) -> Self {
        Self { provider }
    }

    pub async fn run(
        &self,
        task: AiTask,
        window: tauri::Window,
        request_id: String,
    ) -> Result<(), AppError> {
        let tier = classify_task(&task);
        let messages = task.into_messages();
        self.provider
            .stream_completion(messages, tier, window, request_id)
            .await
    }
}
