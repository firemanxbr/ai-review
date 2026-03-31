use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivityEntry {
    pub id: i64,
    pub event_type: String,
    pub repo: String,
    pub pr_number: Option<i64>,
    pub message: String,
    pub created_at: String,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> SqliteResult<Self> {
        let db_path = Self::db_path();
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&db_path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn db_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ai-review")
            .join("ai-review.db")
    }

    fn init_tables(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                head_sha TEXT NOT NULL,
                reviewed_at TEXT NOT NULL,
                UNIQUE(repo, pr_number, head_sha)
            );
            CREATE TABLE IF NOT EXISTS activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                repo TEXT NOT NULL,
                pr_number INTEGER,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;
        Ok(())
    }

    pub fn has_review(&self, repo: &str, pr_number: i64, head_sha: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM reviews WHERE repo = ? AND pr_number = ? AND head_sha = ?",
                rusqlite::params![repo, pr_number, head_sha],
                |row| row.get(0),
            )
            .unwrap_or(0);
        count > 0
    }

    pub fn insert_review(&self, repo: &str, pr_number: i64, head_sha: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO reviews (repo, pr_number, head_sha, reviewed_at) VALUES (?, ?, ?, datetime('now'))",
            rusqlite::params![repo, pr_number, head_sha],
        )?;
        Ok(())
    }

    pub fn delete_review(&self, repo: &str, pr_number: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM reviews WHERE repo = ? AND pr_number = ?",
            rusqlite::params![repo, pr_number],
        )?;
        Ok(())
    }

    pub fn log_activity(
        &self,
        event_type: &str,
        repo: &str,
        pr_number: Option<i64>,
        message: &str,
    ) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO activity_log (event_type, repo, pr_number, message) VALUES (?, ?, ?, ?)",
            rusqlite::params![event_type, repo, pr_number, message],
        )?;
        Ok(())
    }

    pub fn get_recent_activity(&self, limit: i64) -> SqliteResult<Vec<ActivityEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, repo, pr_number, message, created_at FROM activity_log ORDER BY id DESC LIMIT ?",
        )?;
        let entries = stmt
            .query_map(rusqlite::params![limit], |row| {
                Ok(ActivityEntry {
                    id: row.get(0)?,
                    event_type: row.get(1)?,
                    repo: row.get(2)?,
                    pr_number: row.get(3)?,
                    message: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(entries)
    }

    pub fn get_reviewed_prs(&self) -> Vec<(String, i64)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT DISTINCT repo, pr_number FROM reviews")
            .unwrap();
        stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    pub fn set_config(&self, key: &str, value: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    pub fn get_config(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM config WHERE key = ?",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .ok()
    }
}
