use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use aurora_core::AppError;

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
    /// Create a new HistoryDb from a directory path.
    /// Decoupled from Tauri — the caller resolves the path.
    /// Pass `None` for an in-memory database (testing).
    pub fn new(db_dir: Option<PathBuf>) -> Result<Self, AppError> {
        let conn = match db_dir {
            Some(dir) => {
                if !dir.exists() {
                    fs::create_dir_all(&dir)
                        .map_err(|e| AppError::Db(format!("Failed to create db dir: {}", e)))?;
                }
                let db_path = dir.join("history.db");
                Connection::open(db_path)
                    .map_err(|e| AppError::Db(format!("Failed to open database: {}", e)))?
            }
            None => {
                // In-memory database for testing
                Connection::open_in_memory()
                    .map_err(|e| AppError::Db(format!("Failed to open in-memory database: {}", e)))?
            }
        };

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
        ).map_err(|e| AppError::Db(e.to_string()))?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_command ON command_history(command);",
            [],
        ).map_err(|e| AppError::Db(e.to_string()))?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_created ON command_history(created_at DESC);",
            [],
        ).map_err(|e| AppError::Db(e.to_string()))?;

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
        ).map_err(|e| AppError::Db(e.to_string()))?;

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
        ).map_err(|e| AppError::Db(e.to_string()))?;

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
        ).map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    pub fn get_recent(&self, limit: usize) -> Result<Vec<HistoryEntry>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, command, cwd, exit_code, duration_ms, created_at
             FROM command_history ORDER BY created_at DESC LIMIT ?1",
        ).map_err(|e| AppError::Db(e.to_string()))?;
        
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
        }).map_err(|e| AppError::Db(e.to_string()))?;

        let mut entries = Vec::new();
        for r in rows {
            entries.push(r.map_err(|e| AppError::Db(e.to_string()))?);
        }
        Ok(entries)
    }

    /// Prefix-filtered query: returns recent entries whose command starts with the given prefix.
    /// Reduces the candidate set for fuzzy matching, avoiding a full 1000-row load.
    pub fn get_recent_by_prefix(&self, prefix: &str, limit: usize) -> Result<Vec<HistoryEntry>, AppError> {
        let pattern = format!("{}%", prefix);
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, command, cwd, exit_code, duration_ms, created_at
             FROM command_history
             WHERE command LIKE ?1
             ORDER BY created_at DESC LIMIT ?2",
        ).map_err(|e| AppError::Db(e.to_string()))?;

        let rows = stmt.query_map(rusqlite::params![pattern, limit], |row| {
            Ok(HistoryEntry {
                id: Some(row.get(0)?),
                session_id: row.get(1)?,
                command: row.get(2)?,
                cwd: row.get(3)?,
                exit_code: row.get(4)?,
                duration_ms: row.get(5)?,
                created_at: Some(row.get(6)?),
            })
        }).map_err(|e| AppError::Db(e.to_string()))?;

        let mut entries = Vec::new();
        for r in rows {
            entries.push(r.map_err(|e| AppError::Db(e.to_string()))?);
        }
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_memory_db() {
        let db = HistoryDb::new(None).unwrap();
        let entry = HistoryEntry {
            id: None,
            session_id: "test-session".to_string(),
            command: "echo hello".to_string(),
            cwd: "/".to_string(),
            exit_code: Some(0),
            duration_ms: Some(10),
            created_at: None,
        };
        db.add_entry(&entry).unwrap();
        let recent = db.get_recent(10).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].command, "echo hello");
    }
}

