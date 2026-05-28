use std::fs;


use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: Option<i64>,
    pub session_id: String,
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<i64>,
    pub created_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: Option<i64>,
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<String>, // JSON array string
    pub created_at: i64,
}

pub struct HistoryDb {
    conn: Connection,
}

impl HistoryDb {
    pub fn new<R: tauri::Runtime>(manager: &impl tauri::Manager<R>) -> Result<Self, AppError> {
        let app_data_dir = manager
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Db(format!("Failed to get app data dir: {}", e)))?;

        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir)
                .map_err(|e| AppError::Db(format!("Failed to create app data dir: {}", e)))?;
        }

        let db_path = app_data_dir.join("history.db");
        let conn = Connection::open(db_path)
            .map_err(|e| AppError::Db(format!("Failed to open database: {}", e)))?;

        let db = Self { conn };
        db.run_migrations()?;

        Ok(db)
    }

    fn run_migrations(&self) -> Result<(), AppError> {
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS command_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT    NOT NULL,
                command     TEXT    NOT NULL,
                cwd         TEXT    NOT NULL,
                exit_code   INTEGER,
                duration_ms INTEGER,
                created_at  INTEGER NOT NULL
            );",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_command ON command_history(command);",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_created ON command_history(created_at DESC);",
            [],
        )?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS snippets (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL UNIQUE,
                command     TEXT    NOT NULL,
                description TEXT,
                tags        TEXT,
                created_at  INTEGER NOT NULL
            );",
            [],
        )?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions (
                id          TEXT    PRIMARY KEY,
                name        TEXT,
                shell       TEXT    NOT NULL,
                cwd         TEXT    NOT NULL,
                created_at  INTEGER NOT NULL,
                last_used   INTEGER NOT NULL
            );",
            [],
        )?;

        Ok(())
    }

    pub fn add_entry(&self, entry: &HistoryEntry) -> Result<(), AppError> {
        let created_at = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO command_history (session_id, command, cwd, exit_code, duration_ms, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (
                &entry.session_id,
                &entry.command,
                &entry.cwd,
                entry.exit_code,
                entry.duration_ms,
                created_at,
            ),
        )?;
        Ok(())
    }

    pub fn get_recent(&self, limit: usize) -> Result<Vec<HistoryEntry>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, command, cwd, exit_code, duration_ms, created_at
             FROM command_history ORDER BY created_at DESC LIMIT ?1",
        )?;
        
        let rows = stmt.query_map([limit], |row| {
            Ok(HistoryEntry {
                id: Some(row.get(0)?),
                session_id: row.get(1)?,
                command: row.get(2)?,
                cwd: row.get(3)?,
                exit_code: row.get(4)?,
                duration_ms: row.get(5)?,
                created_at: Some(row.get(6)?),
            })
        })?;

        let mut entries = Vec::new();
        for r in rows {
            entries.push(r?);
        }
        Ok(entries)
    }
}
