use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
};

use chrono::Utc;
use rusqlite::{params, Connection, DatabaseName, OptionalExtension, Row};
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
    fn as_str(self) -> &'static str {
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
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

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
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let version =
            connection.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        for (index, migration) in [
            MIGRATION_001,
            MIGRATION_002,
            MIGRATION_003,
            MIGRATION_004,
            MIGRATION_005,
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

    pub fn list_items(&self) -> Result<Vec<CaptureItem>, DatabaseError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, kind, content, status, source_app, source_bundle_id,
                    section_id, attachment_path, created_at, updated_at,
                    thumbnail_path, image_width, image_height
             FROM captures
             ORDER BY created_at DESC",
        )?;

        let rows = statement.query_map([], map_capture)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_item(&self, id: &str) -> Result<CaptureItem, DatabaseError> {
        let connection = self.connection()?;
        query_capture(&connection, id)
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
        let now = Utc::now().to_rfc3339();
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO captures (
                id, kind, content, status, source_app, source_bundle_id,
                section_id, attachment_path, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?8)",
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
        )?;
        drop(connection);

        self.get_item(&id)
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

        let connection = self.connection()?;
        let existing: Option<(String, String)> = connection
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
        let changed = connection.execute(
            "UPDATE captures
             SET content = ?2, kind = ?3, updated_at = ?4
             WHERE id = ?1",
            params![id, content, kind.as_str(), updated_at.to_rfc3339()],
        )?;
        drop(connection);

        if changed == 0 {
            return Err(DatabaseError::NotFound);
        }
        self.get_item(id)
    }

    pub fn toggle_item(&self, id: &str) -> Result<CaptureItem, DatabaseError> {
        let item = self.get_item(id)?;
        let next_status = if item.status == ItemStatus::Open {
            ItemStatus::Done
        } else {
            ItemStatus::Open
        };
        self.set_status(id, next_status)
    }

    pub fn set_status(&self, id: &str, status: ItemStatus) -> Result<CaptureItem, DatabaseError> {
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE captures
             SET status = ?2, updated_at = ?3
             WHERE id = ?1",
            params![id, status.as_str(), Utc::now().to_rfc3339()],
        )?;
        drop(connection);

        if changed == 0 {
            return Err(DatabaseError::NotFound);
        }
        self.get_item(id)
    }

    pub fn delete_item(&self, id: &str) -> Result<(), DatabaseError> {
        let connection = self.connection()?;
        let changed = connection.execute("DELETE FROM captures WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(DatabaseError::NotFound);
        }
        Ok(())
    }

    pub fn list_sections(&self) -> Result<Vec<Section>, DatabaseError> {
        let connection = self.connection()?;
        let mut statement =
            connection.prepare("SELECT id, name, created_at FROM sections ORDER BY name")?;
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
            created_at: Utc::now().to_rfc3339(),
        };
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO sections (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![section.id, section.name, section.created_at],
        )?;
        Ok(section)
    }

    pub fn delete_section(&self, id: &str) -> Result<Vec<CaptureItem>, DatabaseError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let capture_ids = {
            let mut statement = transaction.prepare(
                "SELECT id FROM captures WHERE section_id = ?1 ORDER BY created_at DESC",
            )?;
            let rows = statement.query_map([id], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let changed = transaction.execute("DELETE FROM sections WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(DatabaseError::NotFound);
        }
        transaction.commit()?;
        drop(connection);

        capture_ids
            .iter()
            .map(|capture_id| self.get_item(capture_id))
            .collect()
    }

    pub fn move_items_to_section(
        &self,
        ids: &[String],
        section_id: Option<&str>,
    ) -> Result<Vec<CaptureItem>, DatabaseError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        for id in ids {
            let changed = transaction.execute(
                "UPDATE captures
                 SET section_id = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![id, section_id, Utc::now().to_rfc3339()],
            )?;
            if changed == 0 {
                return Err(DatabaseError::NotFound);
            }
        }
        transaction.commit()?;
        drop(connection);

        ids.iter().map(|id| self.get_item(id)).collect()
    }

    pub fn merge_items(&self, ids: &[String]) -> Result<CaptureItem, DatabaseError> {
        let items = ids
            .iter()
            .map(|id| self.get_item(id))
            .collect::<Result<Vec<_>, _>>()?;
        if items.is_empty() {
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
        let now = Utc::now().to_rfc3339();

        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO captures (
                id, kind, content, status, source_app, source_bundle_id,
                section_id, attachment_path, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, NULL, ?6, ?6)",
            params![
                id,
                ItemKind::Note.as_str(),
                content,
                ItemStatus::Open.as_str(),
                section_id,
                now,
            ],
        )?;
        for item in &items {
            transaction.execute("DELETE FROM captures WHERE id = ?1", [&item.id])?;
        }
        transaction.commit()?;
        drop(connection);

        self.get_item(&id)
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>, DatabaseError> {
        let connection = self.connection()?;
        connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(Into::into)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), DatabaseError> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
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
    connection
        .query_row(
            "SELECT id, kind, content, status, source_app, source_bundle_id,
                section_id, attachment_path, created_at, updated_at,
                thumbnail_path, image_width, image_height
         FROM captures WHERE id = ?1",
            [id],
            map_capture,
        )
        .optional()?
        .ok_or(DatabaseError::NotFound)
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
        let database = Database::open(&path).unwrap();
        assert_eq!(
            database
                .connection()
                .unwrap()
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            5
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
            .merge_items(&[image.id.clone(), note.id.clone()])
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
            .merge_items(&[first.id.clone(), second.id.clone()])
            .expect("merge captures");
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
}
