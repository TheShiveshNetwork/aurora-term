use serde::{Serialize, Deserialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;
use crate::error::AppError;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[command]
pub fn read_dir(path: Option<String>) -> Result<Vec<FileNode>, AppError> {
    let target_path = match path {
        Some(p) => PathBuf::from(p),
        None => std::env::current_dir()?,
    };

    let mut nodes = Vec::new();
    
    if target_path.is_dir() {
        for entry in fs::read_dir(target_path)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            
            // Skip hidden files/directories on Unix (or those starting with .)
            if name.starts_with('.') {
                continue;
            }
            
            let is_dir = path.is_dir();
            nodes.push(FileNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir,
            });
        }
    }

    // Sort folders first, then files alphabetically
    nodes.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(nodes)
}
