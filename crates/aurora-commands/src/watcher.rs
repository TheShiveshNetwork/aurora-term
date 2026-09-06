use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use notify::event::{ModifyKind, RenameMode};
use notify::RecommendedWatcher;
use serde_json::json;
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

/// Purge pending removes older than `window_ms` milliseconds and emit
/// `file-deleted` for any that weren't matched by a create/rename event.
fn purge_stale_pending(
    pending: &mut HashMap<PathBuf, Instant>,
    window_ms: u128,
    now: Instant,
    app: &AppHandle,
) {
    let stale: Vec<PathBuf> = pending.iter()
        .filter(|(_, time)| now.duration_since(**time).as_millis() > window_ms)
        .map(|(path, _)| path.clone())
        .collect();
    for path in stale {
        pending.remove(&path);
        let _ = app.emit("file-deleted", path.to_string_lossy().to_string());
    }
}

/// Try to correlate a newly created/renamed-to path with a pending removed
/// path. Returns the old path if a match was found.
fn correlate_pending_remove(
    pending: &mut HashMap<PathBuf, Instant>,
    new_path: &PathBuf,
    window_ms: u128,
    now: Instant,
) -> Option<PathBuf> {
    let mut best: Option<(PathBuf, Instant)> = None;
    for (old_path, time) in pending.iter() {
        if now.duration_since(*time).as_millis() > window_ms {
            continue;
        }
        // Prefer matching by parent dir (same-dir rename), otherwise take
        // the most recent pending remove (cross-dir rename).
        let same_parent = old_path.parent() == new_path.parent();
        match &best {
            Some((_, best_time)) => {
                if same_parent || time > best_time {
                    best = Some((old_path.clone(), *time));
                }
            }
            None => {
                best = Some((old_path.clone(), *time));
            }
        }
    }
    if let Some((old_path, _)) = best {
        pending.remove(&old_path);
        Some(old_path)
    } else {
        None
    }
}

pub struct FileContentWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
    last_event_times: Arc<Mutex<HashMap<PathBuf, Instant>>>,
    pending_removes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
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
            pending_removes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn set_watched_files(&self, paths: Vec<String>, app: AppHandle) {
        let new_paths: HashSet<PathBuf> = paths.iter()
            .map(PathBuf::from)
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
        let pending_removes = self.pending_removes.clone();
        let app_clone = app.clone();

        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else { return };

            let now = Instant::now();
            // Correlation window: how long to keep a remove buffered
            // before treating it as a true deletion.
            const CORRELATION_WINDOW_MS: u128 = 800;

            match event.kind {
                // ── Direct rename events (paths[0]=from, paths[1]=to) ─────
                EventKind::Modify(ModifyKind::Name(RenameMode::Both))
                | EventKind::Modify(ModifyKind::Name(RenameMode::Any))
                    if event.paths.len() >= 2 =>
                {
                    let old = &event.paths[0];
                    let new = &event.paths[1];
                    {
                        let watch_set = watched_paths.lock().unwrap();
                        if watch_set.contains(old.as_path()) {
                            drop(watch_set);
                            let _ = app_clone.emit("file-renamed", json!({
                                "old_path": old.to_string_lossy(),
                                "new_path": new.to_string_lossy(),
                            }));
                            let mut watch_set = watched_paths.lock().unwrap();
                            watch_set.remove(old);
                            watch_set.insert(new.clone());
                            // Also clear any pending remove for this old path
                            let mut pending = pending_removes.lock().unwrap();
                            pending.remove(old);
                        }
                    }
                }

                // ── Rename From (first half of a split rename event) ─────
                EventKind::Modify(ModifyKind::Name(RenameMode::From))
                    if event.paths.first().is_some() =>
                {
                    let path = &event.paths[0];
                    let is_watched = {
                        let watch_set = watched_paths.lock().unwrap();
                        watch_set.contains(path.as_path())
                    };
                    if is_watched {
                        let mut pending = pending_removes.lock().unwrap();
                        pending.insert(path.clone(), now);
                    }
                }

                // ── Rename To (second half of a split rename event) ──────
                EventKind::Modify(ModifyKind::Name(RenameMode::To))
                    if event.paths.first().is_some() =>
                {
                    let new_path = &event.paths[0];
                    let mut pending = pending_removes.lock().unwrap();
                    if let Some(old_path) = correlate_pending_remove(
                        &mut pending,
                        new_path,
                        CORRELATION_WINDOW_MS,
                        now,
                    ) {
                        drop(pending);
                        let _ = app_clone.emit("file-renamed", json!({
                            "old_path": old_path.to_string_lossy(),
                            "new_path": new_path.to_string_lossy(),
                        }));
                        let mut watch_set = watched_paths.lock().unwrap();
                        watch_set.remove(&old_path);
                        watch_set.insert(new_path.clone());
                    }
                }

                // ── Create events (could be the second half of a rename) ─
                EventKind::Create(_)
                    if event.paths.first().is_some() =>
                {
                    let new_path = &event.paths[0];
                    let mut pending = pending_removes.lock().unwrap();
                    if let Some(old_path) = correlate_pending_remove(
                        &mut pending,
                        new_path,
                        CORRELATION_WINDOW_MS,
                        now,
                    ) {
                        drop(pending);
                        let _ = app_clone.emit("file-renamed", json!({
                            "old_path": old_path.to_string_lossy(),
                            "new_path": new_path.to_string_lossy(),
                        }));
                        let mut watch_set = watched_paths.lock().unwrap();
                        watch_set.remove(&old_path);
                        watch_set.insert(new_path.clone());
                    }
                }

                // ── Remove events (buffer for potential rename correlation) ─
                EventKind::Remove(_)
                    if event.paths.first().is_some() =>
                {
                    let path = &event.paths[0];
                    let is_watched = {
                        let watch_set = watched_paths.lock().unwrap();
                        watch_set.contains(path.as_path())
                    };
                    if is_watched {
                        let mut pending = pending_removes.lock().unwrap();
                        pending.insert(path.clone(), now);
                    }
                }

                // ── Other modify events (data/content changes) ───────────
                EventKind::Modify(_) => {
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
                }

                _ => {}
            }

            // ── Purge stale pending removes that weren't matched ─────────
            {
                let mut pending = pending_removes.lock().unwrap();
                purge_stale_pending(&mut pending, CORRELATION_WINDOW_MS, now, &app_clone);
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
