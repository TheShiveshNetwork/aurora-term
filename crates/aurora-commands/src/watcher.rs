use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
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
