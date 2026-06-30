use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use notify::{Event, RecursiveMode, Watcher};
use notify::RecommendedWatcher;
use tauri::{AppHandle, Emitter};

pub struct FileWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl Default for FileWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
        }
    }

    pub fn watch(&self, path: String, app: AppHandle) {
        let mut watcher_lock = self.watcher.lock().unwrap();

        if let Some(old) = watcher_lock.take() {
            drop(old);
        }

        let app_clone = app.clone();
        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if res.is_ok() {
                let _ = app_clone.emit("fs-tree-changed", ());
            }
        }).ok();

        if let Some(ref mut w) = watcher {
            let _ = w.watch(
                PathBuf::from(&path).as_path(),
                RecursiveMode::Recursive,
            );
        }

        *watcher_lock = watcher;
    }
}

pub struct FileContentWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
    last_event_times: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl Default for FileContentWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl FileContentWatcher {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
            last_event_times: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn set_watched_files(&self, paths: Vec<String>, app: AppHandle) {
        let new_paths: HashSet<PathBuf> = paths.iter()
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .collect();

        {
            let mut watched = self.watched_paths.lock().unwrap();
            *watched = new_paths.clone();
        }

        if new_paths.is_empty() {
            let mut watcher_lock = self.watcher.lock().unwrap();
            *watcher_lock = None;
            return;
        }

        // Collect parent directories (deduplicated)
        let parent_dirs: HashSet<PathBuf> = new_paths.iter()
            .filter_map(|p| p.parent().map(|parent| parent.to_path_buf()))
            .collect();

        let watched_paths = self.watched_paths.clone();
        let last_event_times = self.last_event_times.clone();
        let app_clone = app.clone();

        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else { return };

            let now = Instant::now();
            let changed_paths: Vec<PathBuf> = event.paths.iter()
                .filter(|p| {
                    let watch_set = watched_paths.lock().unwrap();
                    if !watch_set.contains::<std::path::Path>(p.as_path()) {
                        return false;
                    }

                    // Debounce: skip same file within 200ms
                    let mut last_times = last_event_times.lock().unwrap();
                    if let Some(last) = last_times.get(*p) {
                        if now.duration_since(*last).as_millis() < 200 {
                            return false;
                        }
                    }
                    last_times.insert((*p).clone(), now);
                    true
                })
                .cloned()
                .collect();

            for path in changed_paths {
                let _ = app_clone.emit("file-content-changed", path.to_string_lossy().to_string());
            }
        }).ok();

        if let Some(ref mut w) = watcher {
            for dir in &parent_dirs {
                if dir.is_dir() {
                    let _ = w.watch(dir.as_path(), RecursiveMode::NonRecursive);
                }
            }
        }

        *self.watcher.lock().unwrap() = watcher;
    }
}

pub struct GitWatcher {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl Default for GitWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl GitWatcher {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    pub fn store(&self, cwd: String, watcher: RecommendedWatcher) {
        let mut lock = self.watchers.lock().unwrap();
        lock.insert(cwd, watcher);
    }

    pub fn stop_watching(&self, cwd: &str) {
        let mut lock = self.watchers.lock().unwrap();
        lock.remove(cwd);
    }
}

impl Drop for GitWatcher {
    fn drop(&mut self) {
        if let Ok(watchers) = self.watchers.get_mut() {
            watchers.clear();
        }
    }
}
