//! A separate, atomic SQLite snapshot survives loss of the primary data directory.
//! SQLite's backup API includes committed WAL pages; copying captura.db alone does not.
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    collections::HashSet,
    fs,
    fs::File,
    path::{Path, PathBuf},
    sync::Mutex,
};

use rusqlite::{Connection, OpenFlags};

use crate::database::Database;

const DATABASE_FILE: &str = "captura.db";
const MARKER_FILE: &str = "initialized";
const ISSUE_FILE: &str = "recovery-required";

pub struct ProtectedStorage {
    primary: PathBuf,
    backup_dir: PathBuf,
    blocked: bool,
    snapshot_lock: Mutex<()>,
}

impl ProtectedStorage {
    pub fn prepare(primary: PathBuf, backup_dir: PathBuf) -> Result<Self, String> {
        let data_dir = primary.parent().ok_or("Captura data path has no parent")?;
        let backup = backup_dir.join(DATABASE_FILE);
        let marker = backup_dir.join(MARKER_FILE);
        let issue = backup_dir.join(ISSUE_FILE);
        let mut blocked = issue.exists();

        if !primary.exists() {
            if backup.exists() {
                if validate_database(&backup).is_ok() {
                    fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
                    restore_file(&backup, &primary)?;
                    copy_attachments(
                        &backup_dir.join("attachments"),
                        &data_dir.join("attachments"),
                    )?;
                    let _ = fs::remove_file(&issue);
                    blocked = false;
                } else {
                    blocked = true;
                }
            } else if marker.exists() {
                blocked = true;
            }
        } else if backup.exists() && !blocked {
            // A replacement empty store must never overwrite a populated backup.
            if capture_count(&primary).unwrap_or(0) == 0 && capture_count(&backup).unwrap_or(0) > 0
            {
                blocked = true;
            }
        }

        if blocked {
            create_private_directory(&backup_dir)?;
            fs::write(&issue, b"Captura found a missing or replaced database.\n")
                .map_err(|error| error.to_string())?;
        }

        Ok(Self {
            primary,
            backup_dir,
            blocked,
            snapshot_lock: Mutex::new(()),
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
