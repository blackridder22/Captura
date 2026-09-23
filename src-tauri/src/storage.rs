//! A separate, atomic SQLite snapshot survives loss of the primary data directory.
//! SQLite's backup API includes committed WAL pages; copying captura.db alone does not.
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    collections::HashSet,
    fs,
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};

use crate::database::Database;

const DATABASE_FILE: &str = "captura.db";
const MARKER_FILE: &str = "initialized";
const ISSUE_FILE: &str = "recovery-required";
const DIAGNOSTIC_FILE: &str = "diagnostics.jsonl";
const PREVIOUS_DIAGNOSTIC_FILE: &str = "diagnostics.previous.jsonl";
const ACTIVE_SESSION_FILE: &str = "active-session";
const MAX_DIAGNOSTIC_BYTES: u64 = 2 * 1024 * 1024;

struct DiagnosticLog {
    directory: PathBuf,
    session: String,
    write_lock: Mutex<()>,
}

impl DiagnosticLog {
    fn start(directory: &Path, primary: &Path, backup: &Path) -> Result<Self, String> {
        create_private_directory(directory)?;
        let log = Self {
            directory: directory.to_path_buf(),
            session: uuid::Uuid::new_v4().to_string(),
            write_lock: Mutex::new(()),
        };
        let active = directory.join(ACTIVE_SESSION_FILE);
        if let Ok(previous) = fs::read_to_string(&active) {
            log.record(
                "previous_exit_unobserved",
                json!({ "previous_session": previous.trim() }),
            )?;
        }
        log.record(
            "startup_probe",
            json!({
                "primary": file_probe(primary),
                "primary_wal": file_probe(&sqlite_sidecar(primary, "-wal")),
                "backup": file_probe(backup),
                "backup_wal": file_probe(&sqlite_sidecar(backup, "-wal")),
                "primary_captures": capture_count(primary).ok(),
                "backup_captures": capture_count(backup).ok(),
            }),
        )?;
        fs::write(&active, &log.session).map_err(|error| error.to_string())?;
        private_file(&active)?;
        File::open(&active)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
        Ok(log)
    }

    fn record(&self, event: &str, details: Value) -> Result<(), String> {
        let _lock = self.write_lock.lock().map_err(|error| error.to_string())?;
        let path = self.directory.join(DIAGNOSTIC_FILE);
        if fs::metadata(&path).is_ok_and(|metadata| metadata.len() >= MAX_DIAGNOSTIC_BYTES) {
            let previous = self.directory.join(PREVIOUS_DIAGNOSTIC_FILE);
            remove_if_present(&previous)?;
            fs::rename(&path, previous).map_err(|error| error.to_string())?;
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        private_file(&path)?;
        let entry = json!({
            "at_utc": chrono::Utc::now().to_rfc3339(),
            "event": event,
            "session": self.session,
            "pid": std::process::id(),
            "version": env!("CARGO_PKG_VERSION"),
            "details": details,
        });
        serde_json::to_writer(&mut file, &entry).map_err(|error| error.to_string())?;
        file.write_all(b"\n").map_err(|error| error.to_string())?;
        file.sync_data().map_err(|error| error.to_string())
    }

    fn finish(&self) {
        if let Err(error) = self.record("observed_exit", json!({})) {
            eprintln!("Captura diagnostic log failed: {error}");
            return;
        }
        let active = self.directory.join(ACTIVE_SESSION_FILE);
        if fs::read_to_string(&active).is_ok_and(|session| session == self.session) {
            let _ = fs::remove_file(active);
        }
    }
}

fn sqlite_sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = path.as_os_str().to_os_string();
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}

fn file_probe(path: &Path) -> Value {
    match fs::metadata(path) {
        Ok(metadata) => json!({
            "exists": true,
            "bytes": metadata.len(),
            "modified_unix_ms": metadata.modified().ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis()),
        }),
        Err(error) => json!({ "exists": false, "error_kind": format!("{:?}", error.kind()) }),
    }
}

pub struct ProtectedStorage {
    primary: PathBuf,
    backup_dir: PathBuf,
    blocked: bool,
    snapshot_lock: Mutex<()>,
    diagnostics: DiagnosticLog,
}

impl ProtectedStorage {
    pub fn prepare(primary: PathBuf, backup_dir: PathBuf) -> Result<Self, String> {
        let data_dir = primary.parent().ok_or("Captura data path has no parent")?;
        let backup = backup_dir.join(DATABASE_FILE);
        let marker = backup_dir.join(MARKER_FILE);
        let issue = backup_dir.join(ISSUE_FILE);
        let diagnostics_dir = backup_dir
            .parent()
            .ok_or("Captura backup path has no parent")?
            .join("Logs")
            .join("Captura");
        let diagnostics = DiagnosticLog::start(&diagnostics_dir, &primary, &backup)?;
        let mut blocked = issue.exists();

        if !primary.exists() {
            if backup.exists() {
                if validate_database(&backup).is_ok() {
                    diagnostics.record("restore_started", json!({}))?;
                    let restoration = (|| {
                        fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
                        restore_file(&backup, &primary)?;
                        copy_attachments(
                            &backup_dir.join("attachments"),
                            &data_dir.join("attachments"),
                        )
                    })();
                    if let Err(error) = restoration {
                        diagnostics.record("restore_failed", json!({ "error": error }))?;
                        return Err(error);
                    }
                    let _ = fs::remove_file(&issue);
                    blocked = false;
                    diagnostics.record(
                        "restore_succeeded",
                        json!({
                            "primary_captures": capture_count(&primary).ok(),
                        }),
                    )?;
                } else {
                    blocked = true;
                    diagnostics.record("restore_refused", json!({ "reason": "backup_invalid" }))?;
                }
            } else if marker.exists() {
                blocked = true;
                diagnostics.record("restore_refused", json!({ "reason": "backup_missing" }))?;
            }
        } else if backup.exists() && !blocked {
            // A replacement empty store must never overwrite a populated backup.
            if capture_count(&primary).unwrap_or(0) == 0 && capture_count(&backup).unwrap_or(0) > 0
            {
                blocked = true;
                diagnostics.record(
                    "restore_refused",
                    json!({ "reason": "primary_empty_backup_populated" }),
                )?;
            }
        }

        if blocked {
            create_private_directory(&backup_dir)?;
            fs::write(&issue, b"Captura found a missing or replaced database.\n")
                .map_err(|error| error.to_string())?;
        }

        diagnostics.record(
            "storage_ready",
            json!({
                "blocked": blocked,
                "primary": file_probe(&primary),
                "backup": file_probe(&backup),
                "primary_captures": capture_count(&primary).ok(),
                "backup_captures": capture_count(&backup).ok(),
            }),
        )?;

        Ok(Self {
            primary,
            backup_dir,
            blocked,
            snapshot_lock: Mutex::new(()),
            diagnostics,
        })
    }

    pub fn blocked(&self) -> bool {
        self.blocked
    }

    pub fn issue_message(&self) -> String {
        "Saved captures may be missing. Saving is paused to protect recovery. Check the Captura Backups folder in Library."
            .to_string()
    }

    pub fn snapshot(&self, database: &Database) -> Result<(), String> {
        let _snapshot = self
            .snapshot_lock
            .lock()
            .map_err(|_| "Backup lock unavailable")?;
        let result = self.snapshot_inner(database);
        if let Err(error) = self.diagnostics.record(
            "backup_result",
            json!({
                "ok": result.is_ok(),
                "error": result.as_ref().err(),
                "primary_captures": capture_count(&self.primary).ok(),
                "backup_captures": capture_count(&self.backup_dir.join(DATABASE_FILE)).ok(),
                "primary": file_probe(&self.primary),
                "backup": file_probe(&self.backup_dir.join(DATABASE_FILE)),
            }),
        ) {
            eprintln!("Captura diagnostic log failed: {error}");
        }
        result
    }

    pub fn record_event(&self, event: &str) {
        if let Err(error) = self.diagnostics.record(event, json!({})) {
            eprintln!("Captura diagnostic log failed: {error}");
        }
    }

    pub fn record_database_open_failure(&self, error: &str) {
        if let Err(log_error) = self
            .diagnostics
            .record("database_open_failed", json!({ "error": error }))
        {
            eprintln!("Captura diagnostic log failed: {log_error}");
        }
    }

    pub fn record_database_write(&self) {
        if let Err(error) = self.diagnostics.record(
            "database_write_committed",
            json!({
                "primary_captures": capture_count(&self.primary).ok(),
                "primary": file_probe(&self.primary),
            }),
        ) {
            eprintln!("Captura diagnostic log failed: {error}");
        }
    }

    pub fn finish_session(&self) {
        self.diagnostics.finish();
    }

    fn snapshot_inner(&self, database: &Database) -> Result<(), String> {
        if self.blocked {
            return Err(self.issue_message());
        }
        create_private_directory(&self.backup_dir)?;
        let primary_attachments = self
            .primary
            .parent()
            .ok_or("Data directory missing")?
            .join("attachments");
        let backup_attachments = self.backup_dir.join("attachments");
        copy_attachments(&primary_attachments, &backup_attachments)?;

        let temporary = self
            .backup_dir
            .join(format!("captura.db.{}.tmp", std::process::id()));
        remove_if_present(&temporary)?;
        remove_sqlite_sidecars(&temporary)?;
        if let Err(error) = database.backup_to(&temporary) {
            let _ = fs::remove_file(&temporary);
            return Err(error.to_string());
        }
        make_standalone(&temporary)?;
        private_file(&temporary)?;
        File::open(&temporary)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
        validate_database(&temporary)?;
        remove_sqlite_sidecars(&self.backup_dir.join(DATABASE_FILE))?;
        fs::rename(&temporary, self.backup_dir.join(DATABASE_FILE))
            .map_err(|error| error.to_string())?;
        remove_sqlite_sidecars(&temporary)?;
        fs::write(self.backup_dir.join(MARKER_FILE), b"Captura local backup\n")
            .map_err(|error| error.to_string())?;
        prune_unreferenced_attachments(&self.backup_dir.join(DATABASE_FILE), &backup_attachments)?;
        Ok(())
    }
}

fn make_standalone(path: &Path) -> Result<(), String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "DELETE")
        .map_err(|error| error.to_string())?;
    let mode: String = connection
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if mode != "delete" {
        return Err(format!("Backup journal mode remained {mode}"));
    }
    drop(connection);
    remove_sqlite_sidecars(path)
}

fn remove_sqlite_sidecars(path: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        remove_if_present(&PathBuf::from(sidecar))?;
    }
    Ok(())
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn capture_count(path: &Path) -> Result<i64, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    connection
        .query_row("SELECT count(*) FROM captures", [], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn validate_database(path: &Path) -> Result<(), String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err(format!("Backup failed integrity check: {integrity}"));
    }
    capture_count(path)?;
    Ok(())
}

fn restore_file(source: &Path, destination: &Path) -> Result<(), String> {
    let temporary = destination.with_extension("db.restore");
    fs::copy(source, &temporary).map_err(|error| error.to_string())?;
    private_file(&temporary)?;
    File::open(&temporary)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, destination).map_err(|error| error.to_string())
}

fn copy_attachments(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    create_private_directory(destination)?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let target = destination.join(entry.file_name());
        if target.exists() {
            continue;
        } // Imported image names are immutable UUIDs.
        let temporary = target.with_extension("copying");
        fs::copy(entry.path(), &temporary).map_err(|error| error.to_string())?;
        private_file(&temporary)?;
        File::open(&temporary)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
        fs::rename(temporary, target).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn prune_unreferenced_attachments(database: &Path, attachments: &Path) -> Result<(), String> {
    if !attachments.exists() {
        return Ok(());
    }
    let connection = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare("SELECT attachment_path, thumbnail_path FROM captures WHERE kind = 'image'")
        .map_err(|error| error.to_string())?;
    let mut referenced = HashSet::new();
    for row in statement
        .query_map([], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        })
        .map_err(|error| error.to_string())?
    {
        let (original, thumbnail) = row.map_err(|error| error.to_string())?;
        for path in [original, thumbnail].into_iter().flatten() {
            if let Some(name) = Path::new(&path).file_name() {
                referenced.insert(name.to_os_string());
            }
        }
    }
    for entry in fs::read_dir(attachments).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
            && !referenced.contains(&entry.file_name())
        {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn private_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::ItemKind;

    #[test]
    fn diagnostics_record_database_loss_before_restore_without_capture_text() {
        let root = tempfile::tempdir().unwrap();
        let primary = root.path().join("data").join(DATABASE_FILE);
        let backup_dir = root.path().join("backup");
        let diagnostics_dir = root.path().join("Logs").join("Captura");
        let storage = ProtectedStorage::prepare(primary.clone(), backup_dir.clone()).unwrap();
        let database = Database::open(&primary).unwrap();
        database
            .create_item("private capture text", ItemKind::Note, None, None, None)
            .unwrap();
        storage.record_database_write();
        storage.snapshot(&database).unwrap();
        drop(database);
        fs::remove_dir_all(primary.parent().unwrap()).unwrap();

        let recovered = ProtectedStorage::prepare(primary.clone(), backup_dir.clone()).unwrap();
        assert_eq!(capture_count(&primary).unwrap(), 1);
        recovered.finish_session();

        let contents = fs::read_to_string(diagnostics_dir.join(DIAGNOSTIC_FILE)).unwrap();
        assert!(!contents.contains("private capture text"));
        let entries: Vec<Value> = contents
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert!(entries.iter().any(|entry| {
            entry["event"] == "database_write_committed"
                && entry["details"]["primary_captures"] == 1
        }));
        assert!(entries.iter().any(|entry| {
            entry["event"] == "backup_result"
                && entry["details"]["ok"] == true
                && entry["details"]["backup_captures"] == 1
        }));
        let probe = entries
            .iter()
            .rfind(|entry| entry["event"] == "startup_probe")
            .unwrap();
        assert_eq!(probe["details"]["primary"]["exists"], false);
        assert_eq!(probe["details"]["backup_captures"], 1);
        assert!(entries
            .iter()
            .any(|entry| entry["event"] == "restore_succeeded"));
        assert!(entries
            .iter()
            .any(|entry| entry["event"] == "previous_exit_unobserved"));
        assert!(!diagnostics_dir.join(ACTIVE_SESSION_FILE).exists());
    }

    #[test]
    fn restores_saved_capture_and_attachment_after_primary_directory_is_removed() {
        let root = tempfile::tempdir().unwrap();
        let primary = root.path().join("data").join(DATABASE_FILE);
        let storage =
            ProtectedStorage::prepare(primary.clone(), root.path().join("backup")).unwrap();
        let database = Database::open(&primary).unwrap();
        let item = database
            .create_item("keep this", ItemKind::Note, None, None, None)
            .unwrap();
        let attachments = primary.parent().unwrap().join("attachments");
        fs::create_dir_all(&attachments).unwrap();
        fs::write(attachments.join("image.png"), b"image bytes").unwrap();
        let image = database
            .create_item(
                "saved image",
                ItemKind::Image,
                None,
                None,
                Some(&attachments.join("image.png").to_string_lossy()),
            )
            .unwrap();
        storage.snapshot(&database).unwrap();
        let backup = root.path().join("backup").join(DATABASE_FILE);
        assert!(!PathBuf::from(format!("{}-wal", backup.display())).exists());
        assert!(!PathBuf::from(format!("{}-shm", backup.display())).exists());
        drop(database);
        fs::remove_dir_all(primary.parent().unwrap()).unwrap();

        let recovered =
            ProtectedStorage::prepare(primary.clone(), root.path().join("backup")).unwrap();
        assert!(!recovered.blocked());
        let database = Database::open(&primary).unwrap();
        assert_eq!(database.get_item(&item.id).unwrap().content, "keep this");
        assert_eq!(database.get_item(&image.id).unwrap().content, "saved image");
        assert_eq!(
            fs::read(attachments.join("image.png")).unwrap(),
            b"image bytes"
        );
    }

    #[test]
    fn refuses_to_replace_populated_backup_with_empty_database() {
        let root = tempfile::tempdir().unwrap();
        let primary = root.path().join("data").join(DATABASE_FILE);
        let storage =
            ProtectedStorage::prepare(primary.clone(), root.path().join("backup")).unwrap();
        let database = Database::open(&primary).unwrap();
        database
            .create_item("saved", ItemKind::Note, None, None, None)
            .unwrap();
        storage.snapshot(&database).unwrap();
        drop(database);
        fs::remove_dir_all(primary.parent().unwrap()).unwrap();
        let replacement = Database::open(&primary).unwrap();
        drop(replacement);

        let detected =
            ProtectedStorage::prepare(primary.clone(), root.path().join("backup")).unwrap();
        assert!(detected.blocked());
        assert!(detected
            .snapshot(&Database::open(&primary).unwrap())
            .is_err());
        assert_eq!(
            capture_count(&detected.backup_dir.join(DATABASE_FILE)).unwrap(),
            1
        );
    }

    #[test]
    fn missing_backup_after_a_prior_snapshot_pauses_saving() {
        let root = tempfile::tempdir().unwrap();
        let primary = root.path().join("data").join(DATABASE_FILE);
        let backup = root.path().join("backup");
        let storage = ProtectedStorage::prepare(primary.clone(), backup.clone()).unwrap();
        let database = Database::open(&primary).unwrap();
        database
            .create_item("saved", ItemKind::Note, None, None, None)
            .unwrap();
        storage.snapshot(&database).unwrap();
        drop(database);
        fs::remove_dir_all(primary.parent().unwrap()).unwrap();
        fs::remove_file(backup.join(DATABASE_FILE)).unwrap();

        let detected = ProtectedStorage::prepare(primary, backup.clone()).unwrap();
        assert!(detected.blocked());
        assert!(backup.join(ISSUE_FILE).exists());
    }
}
