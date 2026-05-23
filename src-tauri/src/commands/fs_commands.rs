use serde::{Serialize, Deserialize};
use std::path::{Path, PathBuf};
use tauri::command;
use crate::error::AppError;
use ignore::gitignore::{Gitignore, GitignoreBuilder};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_hidden: bool,
    pub is_gitignored: bool,
}

/// Build a gitignore matcher anchored at `root`.
/// Walks up from `root` collecting all .gitignore files (including nested ones).
fn build_gitignore(root: &Path) -> Option<Gitignore> {
    let mut builder = GitignoreBuilder::new(root);

    // Add the root .gitignore if present
    let gi_path = root.join(".gitignore");
    if gi_path.is_file() {
        let _ = builder.add(&gi_path);
    }

    // Also add .git/info/exclude if present
    let exclude_path = root.join(".git").join("info").join("exclude");
    if exclude_path.is_file() {
        let _ = builder.add(&exclude_path);
    }

    builder.build().ok()
}

/// Returns true when `name` is considered hidden:
/// - On Unix: starts with '.'
/// - On Windows: starts with '.' (dotfiles) — we don't check FILE_ATTRIBUTE_HIDDEN
///   since most tooling uses dotfiles as the convention
fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

#[command]
pub fn read_dir(path: Option<String>) -> Result<Vec<FileNode>, AppError> {
    let target_path: PathBuf = match path {
        Some(p) => PathBuf::from(p),
        None => std::env::current_dir()?,
    };

    // Build gitignore matcher for this directory
    let gitignore = build_gitignore(&target_path);

    let mut nodes = Vec::new();

    if target_path.is_dir() {
        for entry in std::fs::read_dir(&target_path)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = path.is_dir();
            let is_hidden = is_hidden_name(&name);

            // Check gitignore status
            let is_gitignored = gitignore
                .as_ref()
                .map(|gi| {
                    gi.matched(&path, is_dir).is_ignore()
                })
                .unwrap_or(false);

            nodes.push(FileNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir,
                is_hidden,
                is_gitignored,
            });
        }
    }

    // Sort: dirs before files, then alphabetically (case-insensitive).
    // Hidden files/dirs are sorted within their group (after non-hidden).
    nodes.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => {
                // Within same type: non-hidden before hidden, then alpha
                match (a.is_hidden, b.is_hidden) {
                    (false, true) => std::cmp::Ordering::Less,
                    (true, false) => std::cmp::Ordering::Greater,
                    _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
                }
            }
        }
    });

    Ok(nodes)
}

// ─── Reveal file/folder in system file manager ─────────────────────────────────
#[command]
pub fn reveal_in_explorer(path: String) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // `/select,<path>` highlights the item inside Explorer
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e: std::io::Error| AppError::Io(e.to_string()))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e: std::io::Error| AppError::Io(e.to_string()))?;
    }

    #[cfg(target_os = "linux")]
    {
        let ok = std::process::Command::new("nautilus")
            .arg("--select")
            .arg(&path)
            .spawn()
            .is_ok();
        if !ok {
            let parent = std::path::Path::new(&path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or(path);
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e: std::io::Error| AppError::Io(e.to_string()))?;
        }
    }

    Ok(())
}
