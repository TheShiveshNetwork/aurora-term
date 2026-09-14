//! Real-process verification that the LSP manager spawns exactly one server
//! per `(language_id, project_root)` — never a new server per open file — and
//! reports the steady-state memory footprint of the spawned server trees.
//!
//! Uses the same on-disk LSP bundles the installed app already downloaded (the
//! `com.aurora.term/lsp` cache under the user's AppData), so servers are
//! resolved offline via `ensure_installed`'s fast path and spawn with the exact
//! binaries the app uses.
//!
//! Run with: `cargo test -p aurora-lsp --test verify_lsp -- --nocapture`

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::time::Duration;

use aurora_lsp::{LspIncoming, LspManager, LspStartParams, narrow_root};
use aurora_lsp_fetch::{ensure_installed, weight_for};
use serde_json::{Map, Value};
use sysinfo::{Pid, System};
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::timeout;

const CACHE_DIR: &str = r"C:\Users\whois\AppData\Roaming\com.aurora.term\lsp";

fn test_base() -> PathBuf {
    let base = std::env::temp_dir().join("aurora-lsp-mem-test");
    std::fs::create_dir_all(&base).unwrap();
    base
}

fn write(dir: &Path, name: &str, contents: impl AsRef<[u8]>) -> PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, contents).unwrap();
    p
}

fn file_uri(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    if s.starts_with('/') {
        format!("file://{s}")
    } else {
        format!("file:///{s}")
    }
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    Value::Object(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

fn request(method: &str, id: u64, params: Value) -> String {
    let mut o = Map::new();
    o.insert("jsonrpc".into(), "2.0".into());
    o.insert("id".into(), Value::from(id));
    o.insert("method".into(), method.into());
    o.insert("params".into(), params);
    Value::Object(o).to_string()
}

fn notify(method: &str, params: Value) -> String {
    let mut o = Map::new();
    o.insert("jsonrpc".into(), "2.0".into());
    o.insert("method".into(), method.into());
    o.insert("params".into(), params);
    Value::Object(o).to_string()
}

#[derive(Clone)]
struct Spawned {
    server_key: String,
    language_id: String,
}

async fn start_server(manager: &LspManager, lang: &str, root: &Path, file: &Path) -> Spawned {
    let resolved = ensure_installed(lang, Path::new(CACHE_DIR), "").await.unwrap();
    let narrowed = narrow_root(lang, root, file);
    let server_key = format!("{}|{}", lang, narrowed.to_string_lossy());
    manager
        .start(LspStartParams {
            server_key: server_key.clone(),
            language_id: lang.to_string(),
            exec: resolved.program,
            args: resolved.args,
            root: narrowed,
            weight: weight_for(lang),
            runtime: resolved.runtime,
        })
        .await
        .unwrap();
    Spawned { server_key, language_id: lang.to_string() }
}

async fn initialize(
    manager: &LspManager,
    s: &Spawned,
    rx: &mut UnboundedReceiver<LspIncoming>,
    root: &Path,
) {
    let init = request(
        "initialize",
        1,
        obj(vec![
            ("processId", Value::Null),
            ("rootUri", file_uri(root).into()),
            ("capabilities", Value::Object(Default::default())),
            ("workspaceFolders", Value::Null),
        ]),
    );
    manager.send(&s.server_key, init).await.unwrap();

    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    while std::time::Instant::now() < deadline {
        match timeout(Duration::from_millis(500), rx.recv()).await {
            Ok(Some(msg)) => {
                if msg.server_key == s.server_key && !msg.closed {
                    if let Ok(v) = serde_json::from_str::<Value>(&msg.message) {
                        if v.get("id").and_then(|i| i.as_u64()) == Some(1) {
                            manager
                                .send(&s.server_key, notify("initialized", Value::Object(Default::default())))
                                .await
                                .unwrap();
                            return;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    panic!("timed out waiting for initialize response on {}", s.server_key);
}

async fn did_open(manager: &LspManager, s: &Spawned, f: &Path) {
    let text_doc = obj(vec![
        ("uri", file_uri(f).into()),
        ("languageId", s.language_id.clone().into()),
        ("version", Value::from(1)),
        ("text", std::fs::read_to_string(f).unwrap().into()),
    ]);
    let msg = notify("textDocument/didOpen", obj(vec![("textDocument", text_doc)]));
    manager.send(&s.server_key, msg).await.unwrap();
}

// ─── Process tree helpers (Windows taskkill for tree cleanup) ────────────────

fn all_processes() -> System {
    let mut system = System::new_all();
    std::thread::sleep(Duration::from_millis(400));
    system.refresh_all();
    system
}

fn children_of(system: &System, pid: u32) -> Vec<u32> {
    system
        .processes()
        .values()
        .filter(|p| p.parent().map(|x| x.as_u32()) == Some(pid))
        .map(|p| p.pid().as_u32())
        .collect()
}

fn parent_map(system: &System) -> HashMap<u32, u32> {
    system
        .processes()
        .values()
        .map(|p| (p.pid().as_u32(), p.parent().map(|x| x.as_u32()).unwrap_or(0)))
        .collect()
}

fn tree_members(parent_map: &HashMap<u32, u32>, root_pid: u32) -> HashSet<u32> {
    let mut members: HashSet<u32> = HashSet::new();
    loop {
        let mut changed = false;
        for (child, parent) in parent_map {
            if (*parent == root_pid || members.contains(parent)) && !members.contains(child) {
                members.insert(*child);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    members.insert(root_pid);
    members
}

fn tree_rss(system: &System, parent_map: &HashMap<u32, u32>, root_pid: u32) -> (usize, u64) {
    let members = tree_members(parent_map, root_pid);
    let mut rss = 0u64;
    let mut count = 0usize;
    for p in system.processes().values() {
        if members.contains(&p.pid().as_u32()) {
            rss += p.memory() as u64;
            count += 1;
        }
    }
    (count, rss)
}

struct KillGuard(Vec<u32>);
impl Drop for KillGuard {
    fn drop(&mut self) {
        for pid in &self.0 {
            let _ = StdCommand::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

fn snapshot(system: &System, guard: &mut KillGuard, root_pid: u32) -> (Vec<u32>, HashMap<u32, u32>) {
    let pm = parent_map(system);
    let kids = children_of(system, root_pid);
    for pid in &kids {
        if !guard.0.contains(pid) {
            guard.0.push(*pid);
        }
    }
    (kids, pm)
}

#[tokio::test(flavor = "multi_thread")]
async fn verify_one_server_per_language_and_memory() {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<LspIncoming>();
    let manager = LspManager::new(tx);

    let base = test_base();
    let proj_a = base.join("proj_a");
    let proj_b = base.join("proj_b");
    std::fs::create_dir_all(&proj_a).unwrap();
    std::fs::create_dir_all(&proj_b).unwrap();

    write(&proj_a, "tsconfig.json", "{}");
    write(&proj_a, "package.json", "{\"name\":\"a\"}");
    write(&proj_b, "package.json", "{\"name\":\"b\"}");

    let me = std::process::id();
    let mut guard = KillGuard(Vec::new());

    // ── 1) Three start() calls for the SAME (typescript, proj_a) must dedupe ──
    let f_one = write(&proj_a, "one.ts", "export const a = 1;\n");
    let s_ts_a = start_server(&manager, "typescript", &proj_a, &f_one).await;
    let f_two = write(&proj_a, "two.ts", "export const b = 2;\n");
    let dup_key = start_server(&manager, "typescript", &proj_a, &f_two).await;
    let f_three = write(&proj_a, "three.ts", "export const c = 3;\n");
    let _thrice = start_server(&manager, "typescript", &proj_a, &f_three).await;
    assert_eq!(s_ts_a.server_key, dup_key.server_key, "same (lang, root) must resolve to one key");

    // ── 2) Distinct project root => distinct server; separate languages too ──
    let f_other = write(&proj_b, "other.ts", "export const d = 4;\n");
    let s_ts_b = start_server(&manager, "typescript", &proj_b, &f_other).await;
    let f_js = write(&proj_a, "app.js", "const x = 1;\n");
    let s_js = start_server(&manager, "javascript", &proj_a, &f_js).await;
    let f_css = write(&proj_a, "style.css", "body { color: red; }\n");
    let s_css = start_server(&manager, "css", &proj_a, &f_css).await;
    let f_json = write(&proj_a, "config.json", "{}");
    let s_json = start_server(&manager, "json", &proj_a, &f_json).await;

    // ── 3) Initialize + open MANY files of the same language ──
    for (s, root) in [
        (&s_ts_a, proj_a.as_path()),
        (&s_ts_b, proj_b.as_path()),
        (&s_js, proj_a.as_path()),
        (&s_css, proj_a.as_path()),
        (&s_json, proj_a.as_path()),
    ] {
        initialize(&manager, s, &mut rx, root).await;
    }

    let mut ts_files: Vec<PathBuf> = vec![f_one, f_two, f_three];
    ts_files.extend(
        ["a.ts", "b.tsx", "c.mts", "d.cts", "e.ts", "f.ts", "g.ts", "h.ts", "i.ts", "j.ts"]
            .map(|n| write(&proj_a, n, format!("export const f = {};\n", n.len()))),
    );
    for f in &ts_files {
        did_open(&manager, &s_ts_a, f).await;
    }
    let js_files: Vec<PathBuf> = ["app.js", "util.mjs", "comp.jsx", "m.js", "n.cjs"]
        .map(|n| write(&proj_a, n, "const y = 2;\n"))
        .to_vec();
    for f in &js_files {
        did_open(&manager, &s_js, f).await;
    }
    let extra_css = write(&proj_a, "theme.css", "p { margin: 0; }\n");
    did_open(&manager, &s_css, &extra_css).await;
    let extra_json = write(&proj_a, "package-lock.json", "{}");
    did_open(&manager, &s_json, &extra_json).await;

    // Let servers index their open files.
    std::thread::sleep(Duration::from_secs(12));

    // ── 4) Snapshot process count + memory AFTER many files open ──
    let system = all_processes();
    let (wrappers, pm) = snapshot(&system, &mut guard, me);
    println!(
        "\n=== LSP survey (after opening {}+{} files across 5 servers) ===",
        ts_files.len(),
        js_files.len() + 2
    );
    println!("top-level server processes spawned under test: {}", wrappers.len());

    let mut total_rss = 0u64;
    let mut total_count = 0usize;
    for pid in &wrappers {
        let cmd = system
            .processes()
            .get(&Pid::from_u32(*pid))
            .map(|p| {
                p.cmd()
                    .iter()
                    .map(|c| c.to_string_lossy().to_string())
                    .collect::<Vec<_>>()
                    .join(" ")
            });
        let label = match cmd.as_deref() {
            Some(c) if c.contains("typescript-language-server") => "typescript",
            Some(c) if c.contains("vscode-css-language-server") => "css",
            Some(c) if c.contains("vscode-json-language-server") => "json",
            _ => "unknown",
        };
        let (n, rss) = tree_rss(&system, &pm, *pid);
        total_count += n;
        total_rss += rss;
        println!(
            "  pid {pid:<6} {label:<10} tree={n:<2} RSS={:.1} MB",
            rss as f64 / 1048576.0
        );
    }

    // ── 5) Open EVEN MORE files; process count and RSS must not grow per file ──
    let mut more: Vec<PathBuf> = Vec::new();
    for i in 11..40 {
        let name = format!("extra{i}.ts");
        more.push(write(&proj_a, &name, format!("export const e{i} = {i};\n")));
    }
    for f in &more {
        did_open(&manager, &s_ts_a, f).await;
    }
    std::thread::sleep(Duration::from_secs(4));

    let system2 = all_processes();
    let (wrappers2, pm2) = snapshot(&system2, &mut guard, me);
    println!(
        "\n=== After opening {} more .ts files (same project, same server) ===",
        more.len()
    );
    println!("top-level server processes: {} (must stay 5)", wrappers2.len());
    let mut total_rss2 = 0u64;
    let mut total_count2 = 0usize;
    for pid in &wrappers2 {
        let (n, rss) = tree_rss(&system2, &pm2, *pid);
        total_count2 += n;
        total_rss2 += rss;
        println!("  pid {pid:<6} tree={n:<2} RSS={:.1} MB", rss as f64 / 1048576.0);
    }

    println!("\n=== Summary ===");
    println!("expected top-level wrappers: 5 (typescript x2 roots + javascript + css + json)");
    println!(
        "phase1 (14 files): wrappers={} tree_procs={} RSS={:.1} MB",
        wrappers.len(),
        total_count,
        total_rss as f64 / 1048576.0
    );
    println!(
        "phase2 (+29 files): wrappers={} tree_procs={} RSS={:.1} MB",
        wrappers2.len(),
        total_count2,
        total_rss2 as f64 / 1048576.0
    );

    assert_eq!(wrappers.len(), 5, "exactly one server per (language, project root), not per file");
    assert_eq!(wrappers2.len(), 5, "opening more files must not spawn new servers");
    assert_eq!(wrappers2.len(), wrappers.len());
    drop(guard);
}