use serde::{Serialize, Deserialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use tauri::command;
use tauri::Emitter;
use base64::Engine;
use serde_json;
use notify::Watcher;
use aurora_core::AppError;
use crate::state::AppState;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::WalkBuilder;

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

static READ_DIR_CACHE: Mutex<Option<(String, Vec<FileNode>, Instant)>> = Mutex::new(None);

#[command]
pub fn read_dir(path: Option<String>) -> Result<Vec<FileNode>, AppError> {
    let target_path: PathBuf = match path {
        Some(p) => PathBuf::from(p),
        None => std::env::current_dir()?,
    };

    let path_str = target_path.to_string_lossy().to_string();

    {
        if let Ok(cache) = READ_DIR_CACHE.lock() {
            if let Some((cached_path, nodes, time)) = cache.as_ref() {
                if *cached_path == path_str && time.elapsed() < std::time::Duration::from_secs(2) {
                    return Ok(nodes.clone());
                }
            }
        }
    }

    let gitignore = build_gitignore(&target_path);

    let mut nodes = Vec::new();

    if target_path.is_dir() {
        for entry in std::fs::read_dir(&target_path)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = path.is_dir();
            let is_hidden = is_hidden_name(&name);

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

    nodes.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => {
                match (a.is_hidden, b.is_hidden) {
                    (false, true) => std::cmp::Ordering::Less,
                    (true, false) => std::cmp::Ordering::Greater,
                    _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
                }
            }
        }
    });

    {
        if let Ok(mut cache) = READ_DIR_CACHE.lock() {
            *cache = Some((path_str, nodes.clone(), Instant::now()));
        }
    }

    Ok(nodes)
}

#[command]
pub fn search_files(root: String, query: String) -> Result<Vec<FileNode>, AppError> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(AppError::Io("Root is not a directory".to_string()));
    }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    let max_results = 50;

    let walker = WalkBuilder::new(&root_path)
        .standard_filters(true)
        .build();

    for entry in walker {
        if results.len() >= max_results {
            break;
        }
        let entry = entry.map_err(|e| AppError::Io(e.to_string()))?;
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if name.is_empty() || is_hidden_name(&name) {
            continue;
        }

        if name.to_lowercase().contains(&query_lower) {
            let is_dir = path.is_dir();
            results.push(FileNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir,
                is_hidden: false,
                is_gitignored: false,
            });
        }
    }

    results.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(results)
}

#[command]
pub fn read_file_content(path: String) -> Result<String, AppError> {
    let file_path = PathBuf::from(path);

    if !file_path.is_file() {
        return Err(AppError::Io("File not found".to_string()));
    }

    // Limit file size to 10MB to prevent loading huge files into editor
    let metadata = std::fs::metadata(&file_path)?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err(AppError::Io("File is too large (>10MB)".to_string()));
    }

    let content = std::fs::read_to_string(&file_path)?;
    Ok(content)
}

#[command]
pub fn read_file_base64(path: String) -> Result<String, AppError> {
    let file_path = PathBuf::from(path);

    if !file_path.is_file() {
        return Err(AppError::Io("File not found".to_string()));
    }

    // Limit file size to 50MB for images
    let metadata = std::fs::metadata(&file_path)?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err(AppError::Io("File is too large (>50MB)".to_string()));
    }

    let bytes = std::fs::read(&file_path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[command]
pub fn write_file_content(path: String, content: String) -> Result<(), AppError> {
    let file_path = PathBuf::from(path);
    std::fs::write(&file_path, &content)?;
    Ok(())
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

// ─── Delete a file or directory ────────────────────────────────────────────────
#[command]
pub fn delete_path(path: String) -> Result<(), AppError> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::Io(format!("Path not found: {}", path)));
    }
    if p.is_dir() {
        std::fs::remove_dir_all(&p)
            .map_err(|e| AppError::Io(e.to_string()))?;
    } else {
        std::fs::remove_file(&p)
            .map_err(|e| AppError::Io(e.to_string()))?;
    }
    Ok(())
}

// ─── Copy a file or directory to a target folder ──────────────────────────────
#[command]
pub fn copy_path(source: String, target_dir: String) -> Result<String, AppError> {
    let src = PathBuf::from(&source);
    if !src.exists() {
        return Err(AppError::Io(format!("Source not found: {}", source)));
    }
    let dest_dir = PathBuf::from(&target_dir);
    if !dest_dir.is_dir() {
        return Err(AppError::Io(format!("Target is not a directory: {}", target_dir)));
    }

    let name = src.file_name()
        .ok_or_else(|| AppError::Io("Invalid source path".to_string()))?;
    let dest = dest_dir.join(name);

    if dest.exists() {
        return Err(AppError::Io(format!("'{}' already exists in target", name.to_string_lossy())));
    }

    if src.is_dir() {
        copy_dir_recursive(&src, &dest)?;
    } else {
        std::fs::copy(&src, &dest)?;
    }

    Ok(dest.to_string_lossy().into_owned())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let next_src = entry.path();
        let next_dest = dest.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&next_src, &next_dest)?;
        } else {
            std::fs::copy(&next_src, &next_dest)?;
        }
    }
    Ok(())
}

// ─── Create a file or directory at a given path ──────────────────────────────
#[command]
pub fn create_path(parent_dir: String, name: String, is_dir: bool) -> Result<String, AppError> {
    let parent = PathBuf::from(&parent_dir);
    if !parent.is_dir() {
        return Err(AppError::Io(format!("Parent is not a directory: {}", parent_dir)));
    }
    let new_path = parent.join(&name);
    if new_path.exists() {
        return Err(AppError::Io(format!("'{}' already exists", name)));
    }
    if is_dir {
        std::fs::create_dir(&new_path)
            .map_err(|e| AppError::Io(e.to_string()))?;
    } else {
        // Create with empty content
        std::fs::write(&new_path, "")
            .map_err(|e| AppError::Io(e.to_string()))?;
    }
    Ok(new_path.to_string_lossy().into_owned())
}

// ─── Rename / move a file or directory ────────────────────────────────────────
#[command]
pub fn rename_path(old_path: String, new_name: String) -> Result<String, AppError> {
    let old = PathBuf::from(&old_path);
    if !old.exists() {
        return Err(AppError::Io(format!("Path not found: {}", old_path)));
    }
    let parent = old.parent()
        .ok_or_else(|| AppError::Io("Cannot rename root path".to_string()))?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err(AppError::Io(format!("'{}' already exists", new_name)));
    }
    std::fs::rename(&old, &new_path)
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(new_path.to_string_lossy().into_owned())
}

#[command]
pub fn move_path(source: String, target_dir: String) -> Result<String, AppError> {
    let src = PathBuf::from(&source);
    if !src.exists() {
        return Err(AppError::Io(format!("Source not found: {}", source)));
    }
    let target = PathBuf::from(&target_dir);
    if !target.is_dir() {
        return Err(AppError::Io(format!("Target is not a directory: {}", target_dir)));
    }
    let name = src.file_name()
        .ok_or_else(|| AppError::Io("Cannot get file name".to_string()))?;
    let new_path = target.join(name);
    if new_path.exists() {
        return Err(AppError::Io(format!("'{}' already exists in target", name.to_string_lossy())));
    }
    std::fs::rename(&src, &new_path)
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(new_path.to_string_lossy().into_owned())
}

// ─── Native Dialog Selectors using rfd ────────────────────────────────────────
#[command]
pub fn select_folder() -> Result<Option<String>, AppError> {
    let folder = rfd::FileDialog::new()
        .set_title("Open Folder")
        .pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().into_owned()))
}

#[command]
pub fn select_file() -> Result<Option<String>, AppError> {
    let file = rfd::FileDialog::new()
        .set_title("Open File")
        .pick_file();
    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

#[command]
pub fn watch_directory(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    state.file_watcher.watch(path, app_handle);
    Ok(())
}

#[command]
pub fn watch_git(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    cwd: String,
) -> Result<(), String> {
    let git_dir = PathBuf::from(&cwd).join(".git");
    if !git_dir.exists() {
        return Err("Not a git repository".to_string());
    }

    let app_clone = app_handle.clone();
    let cwd_for_watcher = cwd.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(event) = res {
            let paths: Vec<String> = event.paths.iter()
                .filter_map(|p| p.file_name().and_then(|n| n.to_str().map(|s| s.to_string())))
                .collect();

            let event_type = if paths.iter().any(|p| p.contains("index") || p.ends_with(".lock")) {
                "index"
            } else if paths.iter().any(|p| p == "HEAD" || p.starts_with("refs/")) {
                "refs"
            } else if paths.iter().any(|p| p.starts_with("FETCH_HEAD") || p.starts_with("refs/remotes/")) {
                "remote"
            } else {
                "index"
            };

            let _ = app_clone.emit("git-changed", serde_json::json!({
                "cwd": cwd_for_watcher,
                "type": event_type,
            }));
        }
    }).map_err(|e| e.to_string())?;

    let paths_to_watch = [
        git_dir.join("index"),
        git_dir.join("HEAD"),
        git_dir.join("FETCH_HEAD"),
        git_dir.join("refs"),
    ];

    for path in &paths_to_watch {
        if path.exists() {
            let _ = watcher.watch(path, if path.is_dir() { notify::RecursiveMode::Recursive } else { notify::RecursiveMode::NonRecursive });
        }
    }

    let _ = watcher.watch(git_dir.as_path(), notify::RecursiveMode::NonRecursive);

    // Store watcher in AppState so it stays alive
    state.git_watcher.store(cwd, watcher);

    Ok(())
}
