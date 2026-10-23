use std::{
    collections::HashMap,
    path::Path,
    sync::{Mutex, MutexGuard},
    time::Duration,
};

use chrono::Utc;
use rusqlite::{params, Connection, DatabaseName, OptionalExtension, Row, ToSql};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

const MIGRATION_001: &str = r#"
CREATE TABLE IF NOT EXISTS captures (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('prompt', 'note', 'link')),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    source_app TEXT,
    source_bundle_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_captures_status_created_at
ON captures(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_captures_kind
ON captures(kind);

PRAGMA user_version = 1;
"#;

const MIGRATION_002: &str = r#"
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL
);

ALTER TABLE captures
ADD COLUMN section_id TEXT REFERENCES sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_captures_section_id
ON captures(section_id);

PRAGMA user_version = 2;
"#;

const MIGRATION_003: &str = r#"
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value)
VALUES ('capture_shortcut', 'Alt+Space');

PRAGMA user_version = 3;
"#;

// Table rebuild: SQLite CHECK constraints cannot be altered in place, and
// the v1 schema pinned kind to prompt/note/link.
const MIGRATION_004: &str = r#"
CREATE TABLE captures_v4 (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('prompt', 'note', 'link', 'image')),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    source_app TEXT,
    source_bundle_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
    attachment_path TEXT
);

INSERT INTO captures_v4 (
    id, kind, content, status, source_app, source_bundle_id,
    created_at, updated_at, section_id
)
SELECT id, kind, content, status, source_app, source_bundle_id,
       created_at, updated_at, section_id
FROM captures;

DROP TABLE captures;
ALTER TABLE captures_v4 RENAME TO captures;

CREATE INDEX IF NOT EXISTS idx_captures_status_created_at
ON captures(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_captures_kind
ON captures(kind);

CREATE INDEX IF NOT EXISTS idx_captures_section_id
ON captures(section_id);

PRAGMA user_version = 4;
"#;

const MIGRATION_005: &str = r#"
ALTER TABLE captures ADD COLUMN thumbnail_path TEXT;
ALTER TABLE captures ADD COLUMN image_width INTEGER;
ALTER TABLE captures ADD COLUMN image_height INTEGER;
PRAGMA user_version = 5;
"#;

// Trash: a nullable timestamp instead of a new status value, so the kind/status
// CHECK constraints stay untouched and every existing query keeps working.
const MIGRATION_006: &str = r#"
ALTER TABLE captures ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_captures_created_at
ON captures(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_captures_deleted_at
ON captures(deleted_at) WHERE deleted_at IS NOT NULL;

PRAGMA user_version = 6;
"#;

pub struct NewImage<'a> {
    pub content: &'a str,
    pub attachment_path: &'a str,
    pub thumbnail_path: &'a str,
    pub width: u32,
    pub height: u32,
    pub section_id: Option<&'a str>,
    pub created_at: &'a str,
    pub source_app: Option<&'a str>,
    pub source_bundle_id: Option<&'a str>,
}

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("capture not found")]
    NotFound,
    #[error("capture content cannot be empty")]
    EmptyContent,
    #[error("image captures can't be merged")]
    CannotMergeImages,
    #[error("This capture changed in another window. Copy your draft before reloading the latest version.")]
    Conflict,
    #[error("database lock was poisoned")]
    Poisoned,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Prompt,
    Note,
    Link,
    Image,
}

impl ItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Prompt => "prompt",
            Self::Note => "note",
            Self::Link => "link",
            Self::Image => "image",
        }
    }

    fn from_database(value: &str) -> Self {
        match value {
            "prompt" => Self::Prompt,
            "link" => Self::Link,
            "image" => Self::Image,
            _ => Self::Note,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Open,
    Done,
}

impl ItemStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Done => "done",
        }
    }

    fn from_database(value: &str) -> Self {
        match value {
            "done" => Self::Done,
            _ => Self::Open,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureItem {
    pub id: String,
    pub kind: ItemKind,
    pub content: String,
    pub status: ItemStatus,
    pub source_app: Option<String>,
    pub source_bundle_id: Option<String>,
    pub section_id: Option<String>,
    pub attachment_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub image_width: Option<u32>,
    pub image_height: Option<u32>,
    pub created_at: String,
    pub updated_at: String,
    /// Set while the capture sits in Trash. Purging removes the row entirely.
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

/// Column list shared by every SELECT/RETURNING so `map_capture` stays in sync.
const CAPTURE_COLUMNS: &str = "id, kind, content, status, source_app, source_bundle_id, \
     section_id, attachment_path, created_at, updated_at, thumbnail_path, image_width, \
     image_height, deleted_at";

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn backup_to(&self, path: &Path) -> Result<(), DatabaseError> {
        let connection = self.connection()?;
        connection.backup(DatabaseName::Main, path, None)?;
        Ok(())
    }

    pub fn open(path: &Path) -> Result<Self, DatabaseError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        }

        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.set_prepared_statement_cache_capacity(64);
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        // WAL + NORMAL is durable across application crashes; only a power
        // loss can drop the last transactions, which the local backup covers.
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "temp_store", "MEMORY")?;
        connection.pragma_update(None, "cache_size", -16_000)?;
        connection.pragma_update(None, "mmap_size", 67_108_864_i64)?;
        let version =
            connection.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        for (index, migration) in [
            MIGRATION_001,
            MIGRATION_002,
            MIGRATION_003,
            MIGRATION_004,
            MIGRATION_005,
            MIGRATION_006,
        ]
        .iter()
        .enumerate()
        {
            if version < (index + 1) as i64 {
                apply_migration(&mut connection, migration)?;
            }
        }

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, DatabaseError> {
        self.connection.lock().map_err(|_| DatabaseError::Poisoned)
    }

    pub fn integrity_check(&self) -> Result<bool, DatabaseError> {
        let connection = self.connection()?;
        let result: String =
            connection.pragma_query_value(None, "integrity_check", |row| row.get(0))?;
        Ok(result == "ok")
    }

    /// Folds the WAL back into the main file. The process never closes the
    /// connection cleanly, so without this the WAL grows across launches.
    pub fn checkpoint(&self, truncate: bool) -> Result<(), DatabaseError> {
        let connection = self.connection()?;
        // PASSIVE never blocks on readers; TRUNCATE also resets the WAL file
        // and is reserved for exit, when nothing else holds the connection.
        let mut statement = connection.prepare(if truncate {
            "PRAGMA wal_checkpoint(TRUNCATE)"
        } else {
            "PRAGMA wal_checkpoint(PASSIVE)"
        })?;
        statement.query_row([], |_| Ok(()))?;
        Ok(())
    }

    pub fn optimize(&self) -> Result<(), DatabaseError> {
        let connection = self.connection()?;
        connection.execute_batch("PRAGMA optimize")?;
        Ok(())
    }

    pub fn count_items(&self) -> Result<i64, DatabaseError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached("SELECT count(*) FROM captures")?;
        statement.query_row([], |row| row.get(0)).map_err(Into::into)
    }

    /// Every capture, including trashed ones (`deleted_at` set). Readers that
    /// must ignore Trash filter on `deleted_at`; file cleanup must not.
    pub fn list_items(&self) -> Result<Vec<CaptureItem>, DatabaseError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached(&format!(
            "SELECT {CAPTURE_COLUMNS} FROM captures ORDER BY created_at DESC"
        ))?;
        let rows = statement.query_map([], map_capture)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_trashed(&self) -> Result<Vec<CaptureItem>, DatabaseError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached(&format!(
            "SELECT {CAPTURE_COLUMNS} FROM captures WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        ))?;
        let rows = statement.query_map([], map_capture)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Paths of every stored image file (trashed captures included), for
    /// orphan cleanup without loading capture text.
    pub fn list_attachment_paths(&self) -> Result<Vec<String>, DatabaseError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached(
            "SELECT attachment_path, thumbnail_path FROM captures WHERE kind = 'image'",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        })?;
        let mut paths = Vec::new();
        for row in rows {
            let (original, thumbnail) = row?;
            paths.extend([original, thumbnail].into_iter().flatten());
        }
        Ok(paths)
    }

    pub fn get_item(&self, id: &str) -> Result<CaptureItem, DatabaseError> {
        let connection = self.connection()?;
        query_capture(&connection, id)
    }

    /// Captures in the requested order; ids that no longer exist are skipped.
    pub fn get_items(&self, ids: &[String]) -> Result<Vec<CaptureItem>, DatabaseError> {
        let connection = self.connection()?;
        query_captures(&connection, ids)
    }

    pub fn create_item(
        &self,
        content: &str,
        kind: ItemKind,
        source_app: Option<&str>,
        source_bundle_id: Option<&str>,
        attachment_path: Option<&str>,
    ) -> Result<CaptureItem, DatabaseError> {
        if content.trim().is_empty() {
            return Err(DatabaseError::EmptyContent);
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached(&format!(
            "INSERT INTO captures (
                id, kind, content, status, source_app, source_bundle_id,
                section_id, attachment_path, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?8)
             RETURNING {CAPTURE_COLUMNS}"
        ))?;
        statement
            .query_row(
                params![
                    id,
                    kind.as_str(),
                    content,
                    ItemStatus::Open.as_str(),
                    source_app,
                    source_bundle_id,
                    attachment_path,
                    now,
                ],
                map_capture,
            )
            .map_err(Into::into)
    }

    pub fn create_image_item(
        &self,
        image: NewImage<'_>,
    ) -> Result<(CaptureItem, bool), DatabaseError> {
        if image.content.trim().is_empty() {
            return Err(DatabaseError::EmptyContent);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let section_exists = match image.section_id {
            Some(id) => transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM sections WHERE id = ?1)",
                [id],
                |row| row.get::<_, bool>(0),
            )?,
            None => true,
        };
        let section = image.section_id.filter(|_| section_exists);
        let id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO captures (id, kind, content, status, source_app, source_bundle_id,
             created_at, updated_at, section_id, attachment_path, thumbnail_path, image_width, image_height)
             VALUES (?1, 'image', ?2, 'open', ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![id, image.content, image.source_app, image.source_bundle_id, image.created_at,
                    section, image.attachment_path, image.thumbnail_path, image.width, image.height],
        )?;
        // A failed readback must still roll back the row. The importer removes
        // its staged files on Err, so no fallible read may follow commit.
        let item = query_capture(&transaction, &id)?;
        transaction.commit()?;
        Ok((item, !section_exists))
    }

    #[cfg(test)]
    pub fn set_image_thumbnail(
        &self,
        id: &str,
        original: &str,
        thumbnail: &str,
        width: u32,
        height: u32,
    ) -> Result<CaptureItem, DatabaseError> {
        self.set_image_thumbnail_if_current(id, original, None, thumbnail, width, height)
    }

    pub fn set_image_thumbnail_if_current(
        &self,
        id: &str,
        original: &str,
        expected_thumbnail: Option<&str>,
        thumbnail: &str,
        width: u32,
        height: u32,
    ) -> Result<CaptureItem, DatabaseError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE captures SET thumbnail_path = ?3, image_width = ?4, image_height = ?5
             WHERE id = ?1 AND attachment_path = ?2 AND thumbnail_path IS ?6 AND kind = 'image'",
            params![id, original, thumbnail, width, height, expected_thumbnail],
        )?;
        if changed == 0 {
            return Err(DatabaseError::Conflict);
        }
        let item = query_capture(&transaction, id)?;
        transaction.commit()?;
        Ok(item)
    }

    #[cfg(test)]
    pub fn update_item(
        &self,
        id: &str,
        content: &str,
        kind: ItemKind,
    ) -> Result<CaptureItem, DatabaseError> {
        self.update_item_if_current(id, content, kind, None)
    }

    pub fn update_item_if_current(
        &self,
        id: &str,
        content: &str,
        kind: ItemKind,
        expected_updated_at: Option<&str>,
    ) -> Result<CaptureItem, DatabaseError> {
        if content.trim().is_empty() {
            return Err(DatabaseError::EmptyContent);
        }

        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let existing: Option<(String, String)> = transaction
            .query_row(
                "SELECT updated_at, kind FROM captures WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (previous_updated_at, previous_kind) = existing.ok_or(DatabaseError::NotFound)?;
        if expected_updated_at.is_some_and(|expected| expected != previous_updated_at) {
            return Err(DatabaseError::Conflict);
        }
        // Captions must never convert an image into a text capture, or vice versa.
        if (previous_kind == "image") != (kind == ItemKind::Image) {
            return Err(DatabaseError::CannotMergeImages);
        }
        let mut updated_at = Utc::now();
        if let Ok(previous) = chrono::DateTime::parse_from_rfc3339(&previous_updated_at) {
            if updated_at <= previous {
                updated_at = previous.with_timezone(&Utc) + chrono::Duration::nanoseconds(1);
            }
        }
        let item = {
            let mut statement = transaction.prepare_cached(&format!(
                "UPDATE captures SET content = ?2, kind = ?3, updated_at = ?4
                 WHERE id = ?1 RETURNING {CAPTURE_COLUMNS}"
            ))?;
            statement
                .query_row(
                    params![id, content, kind.as_str(), updated_at.to_rfc3339()],
                    map_capture,
                )
                .optional()?
                .ok_or(DatabaseError::NotFound)?
        };
        transaction.commit()?;
        Ok(item)
    }

    pub fn toggle_item(&self, id: &str) -> Result<CaptureItem, DatabaseError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached(&format!(
            "UPDATE captures
             SET status = CASE status WHEN 'open' THEN 'done' ELSE 'open' END, updated_at = ?2
             WHERE id = ?1 RETURNING {CAPTURE_COLUMNS}"
        ))?;
        statement
            .query_row(params![id, now_rfc3339()], map_capture)
            .optional()?
            .ok_or(DatabaseError::NotFound)
    }

    pub fn set_status(&self, id: &str, status: ItemStatus) -> Result<CaptureItem, DatabaseError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached(&format!(
            "UPDATE captures SET status = ?2, updated_at = ?3
             WHERE id = ?1 RETURNING {CAPTURE_COLUMNS}"
        ))?;
        statement
            .query_row(params![id, status.as_str(), now_rfc3339()], map_capture)
            .optional()?
            .ok_or(DatabaseError::NotFound)
    }

    /// One transaction for the whole selection. Missing ids are skipped so a
    /// capture deleted elsewhere cannot fail the rest of the batch.
    pub fn set_items_status(
        &self,
        ids: &[String],
        status: ItemStatus,
    ) -> Result<Vec<CaptureItem>, DatabaseError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.connection()?;
        let now = now_rfc3339();
        let sql = format!(
            "UPDATE captures SET status = ?1, updated_at = ?2 WHERE id IN ({})
             RETURNING {CAPTURE_COLUMNS}",
            placeholders(3, ids.len())
        );
        let leading: [&dyn ToSql; 2] = [&status.as_str(), &now];
        update_returning(&connection, &sql, &leading, ids)
    }

    /// Permanent removal of one capture. Production paths use `purge_items`.
    #[cfg(test)]
    pub fn delete_item(&self, id: &str) -> Result<(), DatabaseError> {
        let connection = self.connection()?;
        let changed = connection.execute("DELETE FROM captures WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(DatabaseError::NotFound);
        }
        Ok(())
    }

    /// Soft delete: the rows stay (with files) until restored or purged.
    pub fn trash_items(&self, ids: &[String]) -> Result<Vec<CaptureItem>, DatabaseError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.connection()?;
        let now = now_rfc3339();
        let sql = format!(
            "UPDATE captures SET deleted_at = ?1, updated_at = ?1
             WHERE deleted_at IS NULL AND id IN ({}) RETURNING {CAPTURE_COLUMNS}",
            placeholders(2, ids.len())
        );
        let leading: [&dyn ToSql; 1] = [&now];
        update_returning(&connection, &sql, &leading, ids)
    }

    pub fn restore_items(&self, ids: &[String]) -> Result<Vec<CaptureItem>, DatabaseError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.connection()?;
        let now = now_rfc3339();
        let sql = format!(
            "UPDATE captures SET deleted_at = NULL, updated_at = ?1
             WHERE deleted_at IS NOT NULL AND id IN ({}) RETURNING {CAPTURE_COLUMNS}",
            placeholders(2, ids.len())
        );
        let leading: [&dyn ToSql; 1] = [&now];
        update_returning(&connection, &sql, &leading, ids)
    }

    /// Hard delete. Returns the removed rows so callers can delete their files.
    pub fn purge_items(&self, ids: &[String]) -> Result<Vec<CaptureItem>, DatabaseError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.connection()?;
        let sql = format!(
            "DELETE FROM captures WHERE id IN ({}) RETURNING {CAPTURE_COLUMNS}",
            placeholders(1, ids.len())
        );
        update_returning(&connection, &sql, &[], ids)
    }

    pub fn empty_trash(&self) -> Result<Vec<CaptureItem>, DatabaseError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached(&format!(
            "DELETE FROM captures WHERE deleted_at IS NOT NULL RETURNING {CAPTURE_COLUMNS}"
        ))?;
        let rows = statement.query_map([], map_capture)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Purges trashed captures whose `deleted_at` is older than `cutoff`.
    /// Timestamps are compared after parsing so mixed RFC 3339 spellings
    /// (`Z` vs `+00:00`, 6 vs 9 fractional digits) never misorder.
    pub fn purge_trashed_before(
        &self,
        cutoff: chrono::DateTime<Utc>,
    ) -> Result<Vec<CaptureItem>, DatabaseError> {
        let expired: Vec<String> = self
            .list_trashed()?
            .into_iter()
            .filter(|item| {
                item.deleted_at
                    .as_deref()
                    .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                    .is_some_and(|deleted| deleted.with_timezone(&Utc) < cutoff)
            })
            .map(|item| item.id)
            .collect();
        self.purge_items(&expired)
    }

    pub fn list_sections(&self) -> Result<Vec<Section>, DatabaseError> {
        let connection = self.connection()?;
        let mut statement =
            connection.prepare_cached("SELECT id, name, created_at FROM sections ORDER BY name")?;
        let rows = statement.query_map([], |row| {
            Ok(Section {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn create_section(&self, name: &str) -> Result<Section, DatabaseError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DatabaseError::EmptyContent);
        }

        let section = Section {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            created_at: now_rfc3339(),
        };
        let connection = self.connection()?;
        let mut statement = connection
            .prepare_cached("INSERT INTO sections (id, name, created_at) VALUES (?1, ?2, ?3)")?;
        statement.execute(params![section.id, section.name, section.created_at])?;
        Ok(section)
    }

    /// Unfiles the section's captures (bumping `updated_at` so change events
    /// apply) and removes the section in one transaction.
    pub fn delete_section(&self, id: &str) -> Result<Vec<CaptureItem>, DatabaseError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let mut items = {
            let mut statement = transaction.prepare_cached(&format!(
                "UPDATE captures SET section_id = NULL, updated_at = ?2
                 WHERE section_id = ?1 RETURNING {CAPTURE_COLUMNS}"
            ))?;
            let rows = statement.query_map(params![id, now_rfc3339()], map_capture)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let changed = transaction.execute("DELETE FROM sections WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(DatabaseError::NotFound);
        }
        transaction.commit()?;
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(items)
    }

    pub fn move_items_to_section(
        &self,
        ids: &[String],
        section_id: Option<&str>,
    ) -> Result<Vec<CaptureItem>, DatabaseError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let now = now_rfc3339();
        let sql = format!(
            "UPDATE captures SET section_id = ?1, updated_at = ?2 WHERE id IN ({})
             RETURNING {CAPTURE_COLUMNS}",
            placeholders(3, ids.len())
        );
        let leading: [&dyn ToSql; 2] = [&section_id, &now];
        let items = update_returning(&transaction, &sql, &leading, ids)?;
        let distinct = ids.iter().collect::<std::collections::HashSet<_>>().len();
        if items.len() != distinct {
            return Err(DatabaseError::NotFound);
        }
        transaction.commit()?;
        Ok(items)
    }

    /// Merges text captures into one note. Sources are trashed (restorable)
    /// or purged when `trash_sources` is false. Returns the merged capture and
    /// the sources' final rows.
    pub fn merge_items(
        &self,
        ids: &[String],
        trash_sources: bool,
    ) -> Result<(CaptureItem, Vec<CaptureItem>), DatabaseError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let items = query_captures(&transaction, ids)?;
        if items.is_empty() || items.len() != ids.len() {
            return Err(DatabaseError::NotFound);
        }
        if items.iter().any(|item| item.kind == ItemKind::Image) {
            return Err(DatabaseError::CannotMergeImages);
        }

        let content = items
            .iter()
            .map(|item| item.content.trim())
            .collect::<Vec<_>>()
            .join("\n\n");
        let first_section = items[0].section_id.clone();
        let section_id = items
            .iter()
            .all(|item| item.section_id == first_section)
            .then_some(first_section)
            .flatten();
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();

        let merged = {
            let mut statement = transaction.prepare_cached(&format!(
                "INSERT INTO captures (
                    id, kind, content, status, source_app, source_bundle_id,
                    section_id, attachment_path, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, NULL, ?6, ?6)
                 RETURNING {CAPTURE_COLUMNS}"
            ))?;
            statement.query_row(
                params![
                    id,
                    ItemKind::Note.as_str(),
                    content,
                    ItemStatus::Open.as_str(),
                    section_id,
                    now,
                ],
                map_capture,
            )?
        };
        let sources = if trash_sources {
            let sql = format!(
                "UPDATE captures SET deleted_at = ?1, updated_at = ?1
                 WHERE id IN ({}) RETURNING {CAPTURE_COLUMNS}",
                placeholders(2, ids.len())
            );
            let leading: [&dyn ToSql; 1] = [&now];
            update_returning(&transaction, &sql, &leading, ids)?
        } else {
            let sql = format!(
                "DELETE FROM captures WHERE id IN ({}) RETURNING {CAPTURE_COLUMNS}",
                placeholders(1, ids.len())
            );
            update_returning(&transaction, &sql, &[], ids)?
        };
        transaction.commit()?;
        Ok((merged, sources))
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>, DatabaseError> {
        let connection = self.connection()?;
        let mut statement =
            connection.prepare_cached("SELECT value FROM settings WHERE key = ?1")?;
        statement
            .query_row([key], |row| row.get(0))
            .optional()
            .map_err(Into::into)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), DatabaseError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )?;
        statement.execute(params![key, value])?;
        Ok(())
    }
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

/// `?from, ?from+1, …` for an IN list.
fn placeholders(from: usize, count: usize) -> String {
    (from..from + count)
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Runs an UPDATE/DELETE … RETURNING over `leading` params followed by `ids`,
/// returning rows in the order the ids were requested.
fn update_returning(
    connection: &Connection,
    sql: &str,
    leading: &[&dyn ToSql],
    ids: &[String],
) -> Result<Vec<CaptureItem>, DatabaseError> {
    let mut params: Vec<&dyn ToSql> = leading.to_vec();
    params.extend(ids.iter().map(|id| id as &dyn ToSql));
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map(params.as_slice(), map_capture)?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(order_by_ids(ids, rows))
}

fn order_by_ids(ids: &[String], rows: Vec<CaptureItem>) -> Vec<CaptureItem> {
    let mut by_id: HashMap<String, CaptureItem> =
        rows.into_iter().map(|item| (item.id.clone(), item)).collect();
    ids.iter().filter_map(|id| by_id.remove(id)).collect()
}

fn apply_migration(connection: &mut Connection, migration: &str) -> Result<(), DatabaseError> {
    // Schema changes and user_version advance together, including a table
    // rebuild. An interrupted/failing migration is safe to retry next launch.
    let transaction = connection.transaction()?;
    transaction.execute_batch(migration)?;
    transaction.commit()?;
    Ok(())
}

fn query_capture(connection: &Connection, id: &str) -> Result<CaptureItem, DatabaseError> {
    let mut statement = connection.prepare_cached(&format!(
        "SELECT {CAPTURE_COLUMNS} FROM captures WHERE id = ?1"
    ))?;
    statement
        .query_row([id], map_capture)
        .optional()?
        .ok_or(DatabaseError::NotFound)
}

fn query_captures(connection: &Connection, ids: &[String]) -> Result<Vec<CaptureItem>, DatabaseError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        "SELECT {CAPTURE_COLUMNS} FROM captures WHERE id IN ({})",
        placeholders(1, ids.len())
    );
    update_returning(connection, &sql, &[], ids)
}

fn map_capture(row: &Row<'_>) -> rusqlite::Result<CaptureItem> {
    let kind: String = row.get(1)?;
    let status: String = row.get(3)?;

    Ok(CaptureItem {
        id: row.get(0)?,
        kind: ItemKind::from_database(&kind),
        content: row.get(2)?,
        status: ItemStatus::from_database(&status),
        source_app: row.get(4)?,
        source_bundle_id: row.get(5)?,
        section_id: row.get(6)?,
        attachment_path: row.get(7)?,
        thumbnail_path: row.get(10)?,
        image_width: row.get(11)?,
        image_height: row.get(12)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        deleted_at: row.get(13)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_migration_rolls_back_every_column_and_can_retry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("interrupted-migration.db");
        let mut connection = Connection::open(&path).unwrap();
        for migration in [MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004] {
            apply_migration(&mut connection, migration).unwrap();
        }
        let failing = MIGRATION_005.replace(
            "PRAGMA user_version = 5;",
            "SELECT missing_migration_function(); PRAGMA user_version = 5;",
        );
        assert!(apply_migration(&mut connection, &failing).is_err());
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            4
        );
        let columns: Vec<String> = connection
            .prepare("PRAGMA table_info(captures)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(
            !columns
                .iter()
                .any(|name| ["thumbnail_path", "image_width", "image_height"]
                    .contains(&name.as_str()))
        );
        drop(connection);
        // Reopening retries the failed migration and continues to the latest.
        let database = Database::open(&path).unwrap();
        assert_eq!(
            database
                .connection()
                .unwrap()
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            6
        );
        assert!(database.integrity_check().unwrap());
    }

    #[test]
    fn image_readback_failure_rolls_back_insert_before_importer_removes_files() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("readback.db")).unwrap();
        database.connection().unwrap().execute_batch(
            "CREATE TRIGGER invalid_image_readback AFTER INSERT ON captures WHEN NEW.kind = 'image'
             BEGIN UPDATE captures SET image_width = 'invalid width' WHERE id = NEW.id; END;"
        ).unwrap();
        let result = database.create_image_item(NewImage {
            content: "Image",
            attachment_path: "/tmp/full.png",
            thumbnail_path: "/tmp/thumb.png",
            width: 64,
            height: 32,
            section_id: None,
            created_at: "2026-01-01T00:00:00Z",
            source_app: None,
            source_bundle_id: None,
        });
        assert!(matches!(result, Err(DatabaseError::Sqlite(_))));
        let count: i64 = database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM captures", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            count, 0,
            "a failed readback must not leave a committed capture"
        );
    }

    #[test]
    fn thumbnail_readback_failure_rolls_back_metadata_and_preserves_caption_version() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("thumbnail-readback.db")).unwrap();
        let image = database
            .create_item(
                "Caption",
                ItemKind::Image,
                None,
                None,
                Some("/tmp/full.png"),
            )
            .unwrap();
        database.connection().unwrap().execute_batch(
            "CREATE TRIGGER invalid_thumbnail_readback AFTER UPDATE OF thumbnail_path ON captures
             BEGIN UPDATE captures SET image_width = 'invalid width' WHERE id = NEW.id; END;"
        ).unwrap();
        assert!(database
            .set_image_thumbnail(&image.id, "/tmp/full.png", "/tmp/thumb.png", 64, 32)
            .is_err());
        assert_eq!(database.get_item(&image.id).unwrap(), image);
    }

    #[test]
    fn missing_thumbnail_replacement_checks_previous_path_and_preserves_caption_version() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("thumbnail-replacement.db")).unwrap();
        let image = database
            .create_item(
                "Caption",
                ItemKind::Image,
                None,
                None,
                Some("/tmp/full.png"),
            )
            .unwrap();
        database
            .set_image_thumbnail(&image.id, "/tmp/full.png", "/tmp/missing.png", 64, 32)
            .unwrap();
        let repaired = database
            .set_image_thumbnail_if_current(
                &image.id,
                "/tmp/full.png",
                Some("/tmp/missing.png"),
                "/tmp/repaired.png",
                64,
                32,
            )
            .unwrap();
        assert_eq!(
            repaired.thumbnail_path.as_deref(),
            Some("/tmp/repaired.png")
        );
        assert_eq!(repaired.updated_at, image.updated_at);
        assert!(matches!(
            database.set_image_thumbnail_if_current(
                &image.id,
                "/tmp/full.png",
                Some("/tmp/missing.png"),
                "/tmp/stale.png",
                64,
                32
            ),
            Err(DatabaseError::Conflict)
        ));
        assert_eq!(database.get_item(&image.id).unwrap(), repaired);
    }

    #[test]
    fn migrates_v4_without_changing_captures_or_source() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("migration.db");
        let connection = Connection::open(&path).unwrap();
        for migration in [MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004] {
            connection.execute_batch(migration).unwrap();
        }
        connection.execute("INSERT INTO captures (id, kind, content, status, created_at, updated_at, attachment_path) VALUES ('legacy', 'image', '  Caption  ', 'open', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '/tmp/original.png')", []).unwrap();
        drop(connection);
        let database = Database::open(&path).unwrap();
        let image = database.get_item("legacy").unwrap();
        assert_eq!(image.content, "  Caption  ");
        assert_eq!(image.attachment_path.as_deref(), Some("/tmp/original.png"));
        assert_eq!(image.thumbnail_path, None);
        assert_eq!(image.image_width, None);
        assert!(database.integrity_check().unwrap());
        drop(database);
        assert_eq!(
            Database::open(&path).unwrap().get_item("legacy").unwrap(),
            image
        );
    }

    #[test]
    fn image_insertion_preserves_batch_order_and_deleted_section_falls_back() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("images.db")).unwrap();
        let section = database.create_section("Images").unwrap();
        let first = database
            .create_image_item(NewImage {
                content: "First",
                attachment_path: "/tmp/a.png",
                thumbnail_path: "/tmp/a.thumb.png",
                width: 1024,
                height: 512,
                section_id: Some(&section.id),
                created_at: "2026-01-01T00:00:00.000000002Z",
                source_app: None,
                source_bundle_id: None,
            })
            .unwrap();
        assert!(!first.1);
        assert_eq!(first.0.section_id.as_deref(), Some(section.id.as_str()));
        database.delete_section(&section.id).unwrap();
        let second = database
            .create_image_item(NewImage {
                content: "Second",
                attachment_path: "/tmp/b.png",
                thumbnail_path: "/tmp/b.thumb.png",
                width: 640,
                height: 480,
                section_id: Some(&section.id),
                created_at: "2026-01-01T00:00:00.000000001Z",
                source_app: None,
                source_bundle_id: None,
            })
            .unwrap();
        assert!(second.1);
        assert_eq!(second.0.section_id, None);
        assert_eq!(
            database
                .list_items()
                .unwrap()
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec![first.0.id.as_str(), second.0.id.as_str()]
        );
        assert_eq!(first.0.image_width, Some(1024));
    }

    #[test]
    fn legacy_thumbnail_cannot_overwrite_a_replacement_or_invalidate_a_caption_draft() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("thumbnail.db")).unwrap();
        let image = database
            .create_item(
                "Caption",
                ItemKind::Image,
                None,
                None,
                Some("/tmp/original.png"),
            )
            .unwrap();
        assert!(database
            .set_image_thumbnail(&image.id, "/tmp/replaced.png", "/tmp/thumb.png", 100, 50)
            .is_err());
        let thumbnail = database
            .set_image_thumbnail(&image.id, "/tmp/original.png", "/tmp/thumb.png", 100, 50)
            .unwrap();
        assert_eq!(thumbnail.updated_at, image.updated_at);
        let edited = database
            .update_item_if_current(
                &image.id,
                "Updated caption",
                ItemKind::Image,
                Some(&image.updated_at),
            )
            .unwrap();
        assert_eq!(edited.thumbnail_path.as_deref(), Some("/tmp/thumb.png"));
        database.delete_item(&image.id).unwrap();
        assert!(database
            .set_image_thumbnail(&image.id, "/tmp/original.png", "/tmp/other.png", 100, 50)
            .is_err());
    }

    #[test]
    fn source_whitespace_survives_create_edit_and_stale_save_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("captures.db")).unwrap();
        let source = "  indented code\n\n# Heading\n\n";
        let item = database
            .create_item(source, ItemKind::Note, None, None, None)
            .unwrap();
        assert_eq!(item.content, source);
        let edited = "\n\tmore code\n\n";
        let saved = database
            .update_item_if_current(&item.id, edited, ItemKind::Note, Some(&item.updated_at))
            .unwrap();
        assert_eq!(saved.content, edited);
        assert_ne!(saved.updated_at, item.updated_at);
        assert!(matches!(
            database.update_item_if_current(
                &item.id,
                "stale",
                ItemKind::Note,
                Some(&item.updated_at)
            ),
            Err(DatabaseError::Conflict)
        ));
        assert_eq!(database.get_item(&item.id).unwrap().content, edited);
        assert!(matches!(
            database.update_item(&item.id, " \n\t", ItemKind::Note),
            Err(DatabaseError::EmptyContent)
        ));
    }

    #[test]
    fn image_captions_cannot_discard_attachment_kind() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("captures.db")).unwrap();
        let item = database
            .create_item(
                "Image",
                ItemKind::Image,
                None,
                None,
                Some("/tmp/example.png"),
            )
            .unwrap();
        assert!(database
            .update_item(&item.id, "Caption", ItemKind::Note)
            .is_err());
        let saved = database
            .update_item(&item.id, "Caption", ItemKind::Image)
            .unwrap();
        assert_eq!(saved.attachment_path, item.attachment_path);
    }

    #[test]
    fn stores_image_items_and_refuses_to_merge_them() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = Database::open(&directory.path().join("captura.db")).expect("database");

        let image = database
            .create_item(
                "Image capture",
                ItemKind::Image,
                Some("Preview"),
                None,
                Some("/tmp/example.png"),
            )
            .expect("create image item");
        assert_eq!(image.kind, ItemKind::Image);
        assert_eq!(image.attachment_path.as_deref(), Some("/tmp/example.png"));

        let note = database
            .create_item("A caption", ItemKind::Note, None, None, None)
            .expect("create note");
        let error = database
            .merge_items(&[image.id.clone(), note.id.clone()], true)
            .expect_err("merging images must fail");
        assert!(matches!(error, DatabaseError::CannotMergeImages));
    }

    #[test]
    fn reports_clean_integrity_on_fresh_database() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = Database::open(&directory.path().join("captura.db")).expect("database");
        assert!(database.integrity_check().expect("integrity check"));
    }

    #[test]
    fn persists_and_updates_capture_items() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = Database::open(&directory.path().join("captura.db")).expect("database");

        let created = database
            .create_item(
                "Turn this into a checklist",
                ItemKind::Prompt,
                Some("ChatGPT"),
                Some("com.openai.chat"),
                None,
            )
            .expect("create capture");

        assert_eq!(created.status, ItemStatus::Open);
        assert_eq!(database.list_items().expect("list").len(), 1);

        let toggled = database.toggle_item(&created.id).expect("toggle");
        assert_eq!(toggled.status, ItemStatus::Done);

        let updated = database
            .update_item(&created.id, "Keep this answer", ItemKind::Note)
            .expect("update");
        assert_eq!(updated.kind, ItemKind::Note);

        database.delete_item(&created.id).expect("delete");
        assert!(database.list_items().expect("list").is_empty());
    }

    #[test]
    fn creates_sections_moves_items_and_merges_notes() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = Database::open(&directory.path().join("captura.db")).expect("database");
        let section = database.create_section("Launch").expect("create section");
        let first = database
            .create_item("First thought", ItemKind::Note, None, None, None)
            .expect("first capture");
        let second = database
            .create_item("Second thought", ItemKind::Prompt, None, None, None)
            .expect("second capture");

        let moved = database
            .move_items_to_section(&[first.id.clone(), second.id.clone()], Some(&section.id))
            .expect("move captures");
        assert!(moved
            .iter()
            .all(|item| item.section_id.as_deref() == Some(section.id.as_str())));

        let merged = database
            .merge_items(&[first.id.clone(), second.id.clone()], false)
            .expect("merge captures")
            .0;
        assert_eq!(merged.kind, ItemKind::Note);
        assert_eq!(merged.content, "First thought\n\nSecond thought");
        assert_eq!(merged.section_id.as_deref(), Some(section.id.as_str()));
        assert_eq!(database.list_items().expect("list").len(), 1);
    }

    #[test]
    fn deleting_a_section_moves_its_captures_to_unfiled() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = Database::open(&directory.path().join("captura.db")).expect("database");
        let section = database.create_section("Research").expect("create section");
        let capture = database
            .create_item("# Exact Markdown", ItemKind::Note, None, None, None)
            .expect("create capture");
        database
            .move_items_to_section(std::slice::from_ref(&capture.id), Some(&section.id))
            .expect("file capture");

        let updated = database
            .delete_section(&section.id)
            .expect("delete section");

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].id, capture.id);
        assert_eq!(updated[0].section_id, None);
        assert!(database.list_sections().expect("list sections").is_empty());
        assert_eq!(database.list_items().expect("list captures").len(), 1);
    }

    #[test]
    fn deleting_empty_and_missing_sections_is_deterministic() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = Database::open(&directory.path().join("captura.db")).expect("database");
        let section = database.create_section("Empty").expect("create section");

        assert!(database
            .delete_section(&section.id)
            .expect("delete empty section")
            .is_empty());
        assert!(matches!(
            database
                .delete_section("missing")
                .expect_err("missing section must fail"),
            DatabaseError::NotFound
        ));
    }

    #[test]
    fn persists_app_preferences() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = Database::open(&directory.path().join("captura.db")).expect("database");

        database
            .set_setting("keep_open", "true")
            .expect("save keep-open setting");
        database
            .set_setting("keyboard_shortcuts", r#"{"capture":"Alt+Space"}"#)
            .expect("save shortcuts");

        assert_eq!(
            database.setting("keep_open").expect("read keep-open"),
            Some("true".to_string())
        );
        assert_eq!(
            database
                .setting("keyboard_shortcuts")
                .expect("read shortcuts"),
            Some(r#"{"capture":"Alt+Space"}"#.to_string())
        );
    }

    #[test]
    fn migration_006_adds_trash_column_and_indexes_without_touching_rows() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("trash-migration.db");
        let connection = Connection::open(&path).unwrap();
        for migration in [
            MIGRATION_001,
            MIGRATION_002,
            MIGRATION_003,
            MIGRATION_004,
            MIGRATION_005,
        ] {
            connection.execute_batch(migration).unwrap();
        }
        connection.execute("INSERT INTO captures (id, kind, content, status, created_at, updated_at) VALUES ('legacy', 'note', 'Keep', 'open', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')", []).unwrap();
        drop(connection);
        let database = Database::open(&path).unwrap();
        let legacy = database.get_item("legacy").unwrap();
        assert_eq!(legacy.content, "Keep");
        assert_eq!(legacy.deleted_at, None);
        let indexes: Vec<String> = database
            .connection()
            .unwrap()
            .prepare("PRAGMA index_list(captures)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(indexes.contains(&"idx_captures_created_at".to_string()));
        assert!(indexes.contains(&"idx_captures_deleted_at".to_string()));
        assert_eq!(
            database
                .connection()
                .unwrap()
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            6
        );
        assert!(database.integrity_check().unwrap());
    }

    #[test]
    fn trash_restore_purge_and_empty_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("trash.db")).unwrap();
        let first = database.create_item("First", ItemKind::Note, None, None, None).unwrap();
        let second = database.create_item("Second", ItemKind::Prompt, None, None, None).unwrap();
        let third = database.create_item("Third", ItemKind::Note, None, None, None).unwrap();

        let trashed = database
            .trash_items(&[first.id.clone(), second.id.clone(), "missing".to_string()])
            .unwrap();
        assert_eq!(trashed.len(), 2, "missing ids are skipped");
        assert!(trashed.iter().all(|item| item.deleted_at.is_some()));
        assert_eq!(trashed[0].id, first.id, "rows come back in requested order");
        assert!(trashed[0].updated_at > first.updated_at);
        // Trashing twice is a no-op, not a timestamp refresh.
        assert!(database.trash_items(std::slice::from_ref(&first.id)).unwrap().is_empty());
        assert_eq!(database.list_items().unwrap().len(), 3, "trashed rows are still listed");
        assert_eq!(database.list_trashed().unwrap().len(), 2);

        let restored = database.restore_items(&[first.id.clone(), third.id.clone()]).unwrap();
        assert_eq!(restored.len(), 1, "only trashed captures restore");
        assert_eq!(restored[0].deleted_at, None);

        let purged = database.purge_items(std::slice::from_ref(&second.id)).unwrap();
        assert_eq!(purged[0].content, "Second");
        assert!(matches!(database.get_item(&second.id), Err(DatabaseError::NotFound)));

        database.trash_items(std::slice::from_ref(&third.id)).unwrap();
        let emptied = database.empty_trash().unwrap();
        assert_eq!(emptied.iter().map(|item| item.id.as_str()).collect::<Vec<_>>(), vec![third.id.as_str()]);
        assert_eq!(database.list_items().unwrap().len(), 1);
    }

    #[test]
    fn expired_trash_is_purged_by_parsed_cutoff() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("expiry.db")).unwrap();
        let old = database.create_item("Old", ItemKind::Note, None, None, None).unwrap();
        let fresh = database.create_item("Fresh", ItemKind::Note, None, None, None).unwrap();
        database.trash_items(&[old.id.clone(), fresh.id.clone()]).unwrap();
        // Mixed spellings: nanosecond Zulu for the old row, offset form for the fresh one.
        database
            .connection()
            .unwrap()
            .execute(
                "UPDATE captures SET deleted_at = '2026-01-01T00:00:00.000000001Z' WHERE id = ?1",
                [&old.id],
            )
            .unwrap();
        let cutoff = Utc::now() - chrono::Duration::days(7);
        let purged = database.purge_trashed_before(cutoff).unwrap();
        assert_eq!(purged.len(), 1);
        assert_eq!(purged[0].id, old.id);
        assert!(database.get_item(&fresh.id).unwrap().deleted_at.is_some());
    }

    #[test]
    fn bulk_status_is_one_transaction_and_section_moves_stay_atomic() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("bulk.db")).unwrap();
        let a = database.create_item("A", ItemKind::Note, None, None, None).unwrap();
        let b = database.create_item("B", ItemKind::Note, None, None, None).unwrap();
        let done = database
            .set_items_status(&[b.id.clone(), a.id.clone(), "gone".to_string()], ItemStatus::Done)
            .unwrap();
        assert_eq!(done.iter().map(|item| item.id.as_str()).collect::<Vec<_>>(), vec![b.id.as_str(), a.id.as_str()]);
        assert!(done.iter().all(|item| item.status == ItemStatus::Done));

        let section = database.create_section("Later").unwrap();
        assert!(matches!(
            database.move_items_to_section(&[a.id.clone(), "gone".to_string()], Some(&section.id)),
            Err(DatabaseError::NotFound)
        ));
        assert_eq!(database.get_item(&a.id).unwrap().section_id, None, "failed batch rolled back");
        let moved = database.move_items_to_section(&[a.id.clone(), b.id.clone()], Some(&section.id)).unwrap();
        assert!(moved.iter().all(|item| item.section_id.as_deref() == Some(section.id.as_str())));
        let unfiled = database.delete_section(&section.id).unwrap();
        assert_eq!(unfiled.len(), 2);
        assert!(unfiled.iter().all(|item| item.section_id.is_none() && item.updated_at > moved[0].updated_at));
    }

    #[test]
    fn merge_trashes_or_purges_its_sources() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("merge.db")).unwrap();
        let a = database.create_item("A", ItemKind::Note, None, None, None).unwrap();
        let b = database.create_item("B", ItemKind::Note, None, None, None).unwrap();
        let (merged, sources) = database.merge_items(&[a.id.clone(), b.id.clone()], true).unwrap();
        assert_eq!(merged.content, "A\n\nB");
        assert_eq!(sources.len(), 2);
        assert!(sources.iter().all(|item| item.deleted_at.is_some()));
        assert_eq!(database.list_trashed().unwrap().len(), 2);

        let c = database.create_item("C", ItemKind::Note, None, None, None).unwrap();
        let (merged_again, purged) = database.merge_items(&[merged.id.clone(), c.id.clone()], false).unwrap();
        assert_eq!(merged_again.content, "A\n\nB\n\nC");
        assert_eq!(purged.len(), 2);
        assert!(matches!(database.get_item(&c.id), Err(DatabaseError::NotFound)));
        assert!(matches!(
            database.merge_items(&[merged_again.id.clone(), "missing".to_string()], true),
            Err(DatabaseError::NotFound)
        ));
    }

    #[test]
    fn returning_rows_match_a_fresh_readback() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("returning.db")).unwrap();
        let created = database.create_item("Row", ItemKind::Prompt, Some("Safari"), Some("com.apple.Safari"), None).unwrap();
        assert_eq!(database.get_item(&created.id).unwrap(), created);
        let toggled = database.toggle_item(&created.id).unwrap();
        assert_eq!(database.get_item(&created.id).unwrap(), toggled);
        assert_eq!(toggled.status, ItemStatus::Done);
        let edited = database.update_item_if_current(&created.id, "Edited", ItemKind::Note, Some(&toggled.updated_at)).unwrap();
        assert_eq!(database.get_item(&created.id).unwrap(), edited);
        assert_eq!(database.get_items(&["nope".to_string(), created.id.clone()]).unwrap(), vec![edited]);
        assert_eq!(database.list_attachment_paths().unwrap(), Vec::<String>::new());
        database.checkpoint(false).unwrap();
        database.checkpoint(true).unwrap();
        database.optimize().unwrap();
        assert_eq!(database.count_items().unwrap(), 1);
    }

    /// `cargo test --release -- --ignored --nocapture database_micro_bench`
    #[test]
    #[ignore]
    fn database_micro_bench() {
        use std::time::Instant;
        fn percentile(samples: &mut [f64], fraction: f64) -> f64 {
            samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
            samples[((samples.len() - 1) as f64 * fraction).round() as usize]
        }
        for rows in [1_000usize, 10_000] {
            let directory = tempfile::tempdir().unwrap();
            let database = Database::open(&directory.path().join("bench.db")).unwrap();
            let mut creates = Vec::new();
            let mut ids = Vec::new();
            for index in 0..rows {
                let started = Instant::now();
                let item = database
                    .create_item(&format!("Capture {index} with some Markdown **body** text"), ItemKind::Note, None, None, None)
                    .unwrap();
                creates.push(started.elapsed().as_secs_f64() * 1000.0);
                ids.push(item.id);
            }
            let mut lists = Vec::new();
            for _ in 0..20 {
                let started = Instant::now();
                let _ = database.list_items().unwrap();
                lists.push(started.elapsed().as_secs_f64() * 1000.0);
            }
            let mut toggles = Vec::new();
            for id in ids.iter().take(200) {
                let started = Instant::now();
                database.toggle_item(id).unwrap();
                toggles.push(started.elapsed().as_secs_f64() * 1000.0);
            }
            let batch: Vec<String> = ids.iter().take(100).cloned().collect();
            let started = Instant::now();
            database.trash_items(&batch).unwrap();
            let trash_100 = started.elapsed().as_secs_f64() * 1000.0;
            let started = Instant::now();
            database.purge_items(&batch).unwrap();
            let purge_100 = started.elapsed().as_secs_f64() * 1000.0;
            println!(
                "rows={rows} create p50={:.3}ms p95={:.3}ms | list p50={:.2}ms p95={:.2}ms | toggle p50={:.3}ms p95={:.3}ms | trash100={trash_100:.2}ms purge100={purge_100:.2}ms",
                percentile(&mut creates, 0.5), percentile(&mut creates, 0.95),
                percentile(&mut lists, 0.5), percentile(&mut lists, 0.95),
                percentile(&mut toggles, 0.5), percentile(&mut toggles, 0.95),
            );
        }
    }
}
