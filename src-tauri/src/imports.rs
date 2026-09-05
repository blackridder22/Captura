//! Shared image entry points. AppKit snapshots representations; one bounded
//! service validates and decodes off the UI thread, then publishes one batch.
use crate::{
    attachments_dir,
    database::{CaptureItem, Database, DatabaseError, ItemKind, NewImage},
    image_import::{
        ImageImportService, ImageInput, ImportBatchResult, ImportRequest, Persisted,
        PreparedThumbnail,
    },
    platform::image_native,
    AppState,
};
use chrono::SecondsFormat;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Condvar, Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};

// Keep the panel alive while the native image chooser owns keyboard focus.
struct ImagePickerInteraction(AppHandle);
impl ImagePickerInteraction {
    fn begin(app: &AppHandle) -> Self {
        app.state::<AppState>()
            .open_image_pickers
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        Self(app.clone())
    }
}
impl Drop for ImagePickerInteraction {
    fn drop(&mut self) {
        self.0
            .state::<AppState>()
            .open_image_pickers
            .fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
        crate::finish_image_picker(&self.0);
    }
}

pub fn import_blocking(
    app: &AppHandle,
    request: ImportRequest,
    source_app: Option<&str>,
    source_bundle_id: Option<&str>,
) -> Result<ImportBatchResult<CaptureItem>, String> {
    let state = app.state::<AppState>();
    let mut result =
        state
            .image_imports
            .import_batch(request, &attachments_dir()?, |image, section| {
                // No ordering/DB lock is held while ImageIO decodes or writes files.
                let _ordering = state
                    .changes
                    .lock()
                    .map_err(|_| "Capture state unavailable")?;
                let created_at = (image.batch_started_at
                    - chrono::Duration::nanoseconds(image.input_index as i64))
                .to_rfc3339_opts(SecondsFormat::Nanos, true);
                let (item, section_missing) = state
                    .database
                    .create_image_item(NewImage {
                        content: &image.label,
                        attachment_path: &image.attachment_path.to_string_lossy(),
                        thumbnail_path: &image.thumbnail_path.to_string_lossy(),
                        width: image.width,
                        height: image.height,
                        section_id: section,
                        created_at: &created_at,
                        source_app,
                        source_bundle_id,
                    })
                    .map_err(|e| e.to_string())?;
                Ok(Persisted {
                    item,
                    section_missing,
                })
            })?;
    if !result.items.is_empty() {
        let ids: Vec<_> = result.items.iter().map(|item| item.id.clone()).collect();
        // A capture may have been edited/deleted while later images decoded.
        // Publish its current state, never resurrect an earlier batch result.
        result.items = crate::mutate_items(app, &state, |database| {
            let items = current_imported_items(database, &ids)?;
            Ok((items.clone(), items, vec![]))
        })?;
    }
    Ok(result)
}

fn current_imported_items(database: &Database, ids: &[String]) -> Result<Vec<CaptureItem>, String> {
    let mut items = Vec::with_capacity(ids.len());
    for id in ids {
        match database.get_item(id) {
            Ok(item) => items.push(item),
            Err(DatabaseError::NotFound) => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(items)
}

async fn import(
    app: AppHandle,
    request: ImportRequest,
) -> Result<ImportBatchResult<CaptureItem>, String> {
    tauri::async_runtime::spawn_blocking(move || import_blocking(&app, request, None, None))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn choose_image_files(
    app: AppHandle,
    request_id: String,
    section_id: Option<String>,
) -> Result<ImportBatchResult<CaptureItem>, String> {
    let interaction = ImagePickerInteraction::begin(&app);
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let Some(mtm) = objc2::MainThreadMarker::new() else {
            let _ = sender.send(Err("Image picker unavailable".into()));
            return;
        };
        image_native::begin_choose_images(mtm, move |result| {
            drop(interaction);
            let _ = sender.send(result);
        });
    })
    .map_err(|e| e.to_string())?;
    let inputs =
        tauri::async_runtime::spawn_blocking(move || receiver.recv().map_err(|e| e.to_string()))
            .await
            .map_err(|e| e.to_string())???;
    match inputs {
        Some(inputs) => {
            import(
                app,
                ImportRequest {
                    request_id,
                    section_id,
                    inputs,
                },
            )
            .await
        }
        None => Ok(ImportBatchResult::cancelled(request_id)),
    }
}

pub fn clipboard_inputs(app: &AppHandle) -> Result<Vec<ImageInput>, String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let inputs = objc2::MainThreadMarker::new()
            .map(image_native::snapshot_clipboard_images)
            .unwrap_or_default();
        let _ = sender.send(inputs);
    })
    .map_err(|e| e.to_string())?;
    receiver
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn paste_image_from_clipboard(
    app: AppHandle,
    request_id: String,
    section_id: Option<String>,
) -> Result<ImportBatchResult<CaptureItem>, String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let inputs = objc2::MainThreadMarker::new()
            .map(image_native::snapshot_clipboard_images)
            .unwrap_or_default();
        let _ = sender.send(inputs);
    })
    .map_err(|e| e.to_string())?;
    let inputs =
        tauri::async_runtime::spawn_blocking(move || receiver.recv().map_err(|e| e.to_string()))
            .await
            .map_err(|e| e.to_string())??;
    import(
        app,
        ImportRequest {
            request_id,
            section_id,
            inputs,
        },
    )
    .await
}

#[tauri::command]
pub async fn ensure_image_thumbnail(app: AppHandle, id: String) -> Result<CaptureItem, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let attachments = attachments_dir()?;
        coalesce_thumbnail((attachments.clone(), id.clone()), || {
            ensure_current_thumbnail(
                &state.database,
                &state.image_imports,
                &id,
                &attachments,
                |original, expected_thumbnail, thumbnail| {
                    crate::mutate_one(&app, &state, |database| {
                        database.set_image_thumbnail_if_current(
                            &id,
                            original,
                            expected_thumbnail,
                            &thumbnail.thumbnail_path.to_string_lossy(),
                            thumbnail.width,
                            thumbnail.height,
                        )
                    })
                },
            )
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn ensure_current_thumbnail(
    database: &Database,
    service: &ImageImportService,
    id: &str,
    attachments: &Path,
    persist: impl FnOnce(&str, Option<&str>, &PreparedThumbnail) -> Result<CaptureItem, String>,
) -> Result<CaptureItem, String> {
    // Coalescing happens before this read: two windows requesting the same
    // legacy capture share its in-flight work and cannot create competing files.
    let item = database.get_item(id).map_err(|error| error.to_string())?;
    if item.kind != ItemKind::Image {
        return Err("This capture is not an image.".to_string());
    }
    if let Some(path) = &item.thumbnail_path {
        match std::fs::metadata(path) {
            Ok(metadata) if metadata.is_file() && metadata.len() > 0 => return Ok(item),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Could not read the image thumbnail: {error}")),
        }
    }
    let original = item
        .attachment_path
        .as_deref()
        .ok_or("This capture has no image file")?;
    service.ensure_thumbnail(Path::new(original), attachments, |thumbnail| {
        persist(original, item.thumbnail_path.as_deref(), thumbnail)
    })
}

type ThumbnailKey = (PathBuf, String);
type ThumbnailResult = Result<CaptureItem, String>;
#[derive(Default)]
struct ThumbnailJob {
    result: Mutex<Option<ThumbnailResult>>,
    ready: Condvar,
}
static THUMBNAIL_JOBS: OnceLock<Mutex<HashMap<ThumbnailKey, Arc<ThumbnailJob>>>> = OnceLock::new();

fn thumbnail_jobs() -> &'static Mutex<HashMap<ThumbnailKey, Arc<ThumbnailJob>>> {
    THUMBNAIL_JOBS.get_or_init(Mutex::default)
}

struct ThumbnailCompletion {
    key: ThumbnailKey,
    job: Arc<ThumbnailJob>,
    completed: bool,
}
impl ThumbnailCompletion {
    fn finish(&mut self, result: ThumbnailResult) {
        if let Ok(mut stored) = self.job.result.lock() {
            *stored = Some(result);
        }
        self.job.ready.notify_all();
        if let Ok(mut jobs) = thumbnail_jobs().lock() {
            if jobs
                .get(&self.key)
                .is_some_and(|job| Arc::ptr_eq(job, &self.job))
            {
                jobs.remove(&self.key);
            }
        }
        self.completed = true;
    }
}
impl Drop for ThumbnailCompletion {
    fn drop(&mut self) {
        if !self.completed {
            self.finish(Err(
                "Thumbnail generation was interrupted. Try again.".to_string()
            ));
        }
    }
}

fn wait_for_thumbnail(job: &ThumbnailJob) -> ThumbnailResult {
    let mut result = job
        .result
        .lock()
        .map_err(|_| "Thumbnail state unavailable")?;
    while result.is_none() {
        result = job
            .ready
            .wait(result)
            .map_err(|_| "Thumbnail state unavailable")?;
    }
    result.as_ref().expect("completed thumbnail result").clone()
}

fn join_thumbnail_job(key: &ThumbnailKey) -> Result<(Arc<ThumbnailJob>, bool), String> {
    let mut jobs = thumbnail_jobs()
        .lock()
        .map_err(|_| "Thumbnail state unavailable")?;
    Ok(match jobs.get(key) {
        Some(job) => (job.clone(), false),
        None => {
            let job = Arc::new(ThumbnailJob::default());
            jobs.insert(key.clone(), job.clone());
            (job, true)
        }
    })
}

fn coalesce_thumbnail(
    key: ThumbnailKey,
    generate: impl FnOnce() -> ThumbnailResult,
) -> ThumbnailResult {
    let (job, owns_work) = join_thumbnail_job(&key)?;
    if !owns_work {
        return wait_for_thumbnail(&job);
    }
    let mut completion = ThumbnailCompletion {
        key,
        job,
        completed: false,
    };
    // Neither the registry nor the result mutex is held during file/codec/DB
    // work. This registry stores only active requests and is cleared on panic.
    let result = generate();
    completion.finish(result.clone());
    result
}

struct CleanupAttempt {
    app: AppHandle,
    completed: bool,
}
impl CleanupAttempt {
    fn complete(&mut self) {
        self.completed = true;
    }
}
impl Drop for CleanupAttempt {
    fn drop(&mut self) {
        if !self.completed {
            self.app
                .state::<AppState>()
                .image_cleanup_started
                .store(false, std::sync::atomic::Ordering::Release);
        }
    }
}

#[tauri::command]
pub async fn cleanup_image_files(app: AppHandle) -> Result<(), String> {
    if app
        .state::<AppState>()
        .image_cleanup_started
        .swap(true, std::sync::atomic::Ordering::AcqRel)
    {
        return Ok(());
    }
    let mut attempt = CleanupAttempt {
        app: app.clone(),
        completed: false,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let paths: HashSet<_> = state
            .database
            .list_items()
            .map_err(|e| e.to_string())?
            .into_iter()
            .flat_map(|item| [item.attachment_path, item.thumbnail_path])
            .flatten()
            .map(PathBuf::from)
            .collect();
        let report = state.image_imports.cleanup(&attachments_dir()?, &paths)?;
        if !report.errors.is_empty() {
            return Err(format!(
                "Image cleanup had {} error(s): {}",
                report.errors.len(),
                report
                    .errors
                    .iter()
                    .take(3)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("; ")
            ));
        }
        attempt.complete();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_readback_skips_deleted_items_but_propagates_database_errors() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("batch.db");
        let database = Database::open(&path).unwrap();
        let live = database
            .create_item("Live", ItemKind::Note, None, None, None)
            .unwrap();
        let deleted = database
            .create_item("Deleted", ItemKind::Note, None, None, None)
            .unwrap();
        database.delete_item(&deleted.id).unwrap();
        let ids = vec![live.id.clone(), deleted.id];
        assert_eq!(
            current_imported_items(&database, &ids).unwrap().as_slice(),
            std::slice::from_ref(&live)
        );
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute(
                "UPDATE captures SET image_width = 'broken' WHERE id = ?1",
                [&live.id],
            )
            .unwrap();
        assert!(
            current_imported_items(&database, &ids).is_err(),
            "failed readback must not be mistaken for a deletion"
        );
    }

    #[test]
    fn thumbnail_cache_is_idempotent_and_missing_files_regenerate_without_stale_edit_conflicts() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("cache.db")).unwrap();
        let service = ImageImportService::default();
        let original = directory.path().join("original.png");
        std::fs::write(
            &original,
            include_bytes!("../tests/fixtures/images/alpha.png"),
        )
        .unwrap();
        let image = database
            .create_item(
                "Caption",
                ItemKind::Image,
                None,
                None,
                Some(&original.to_string_lossy()),
            )
            .unwrap();
        let attachments = directory.path().join("attachments");
        let ensure = || {
            coalesce_thumbnail((attachments.clone(), image.id.clone()), || {
                ensure_current_thumbnail(
                    &database,
                    &service,
                    &image.id,
                    &attachments,
                    |original, previous, thumbnail| {
                        database
                            .set_image_thumbnail_if_current(
                                &image.id,
                                original,
                                previous,
                                &thumbnail.thumbnail_path.to_string_lossy(),
                                thumbnail.width,
                                thumbnail.height,
                            )
                            .map_err(|error| error.to_string())
                    },
                )
            })
        };
        let first = ensure().unwrap();
        assert_eq!(ensure().unwrap(), first);
        assert_eq!(std::fs::read_dir(&attachments).unwrap().count(), 1);
        std::fs::remove_file(first.thumbnail_path.as_deref().unwrap()).unwrap();
        let repaired = ensure().unwrap();
        assert_ne!(repaired.thumbnail_path, first.thumbnail_path);
        assert_eq!(repaired.updated_at, image.updated_at);
        assert_eq!(std::fs::read_dir(&attachments).unwrap().count(), 1);
        let saved = database
            .update_item_if_current(
                &image.id,
                "Changed caption",
                ItemKind::Image,
                Some(&image.updated_at),
            )
            .unwrap();
        assert_eq!(saved.content, "Changed caption");
        assert_eq!(saved.thumbnail_path, repaired.thumbnail_path);
    }

    #[test]
    fn thumbnail_waiters_receive_one_result_and_active_registry_is_released() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("coalesced.db")).unwrap();
        let image = database
            .create_item(
                "Caption",
                ItemKind::Image,
                None,
                None,
                Some("/tmp/original.png"),
            )
            .unwrap();
        let key = (directory.path().to_path_buf(), image.id.clone());
        let mut waiters = Vec::new();
        let result = coalesce_thumbnail(key.clone(), || {
            for _ in 0..4 {
                let (job, owns_work) = join_thumbnail_job(&key).unwrap();
                assert!(!owns_work);
                waiters.push(std::thread::spawn(move || wait_for_thumbnail(&job)));
            }
            Ok(image.clone())
        })
        .unwrap();
        for waiter in waiters {
            assert_eq!(waiter.join().unwrap().unwrap(), result);
        }
        assert!(!thumbnail_jobs().lock().unwrap().contains_key(&key));
    }

    #[test]
    fn abandoned_thumbnail_job_releases_waiters_and_allows_retry() {
        let directory = tempfile::tempdir().unwrap();
        let key = (directory.path().to_path_buf(), "abandoned".to_string());
        let (job, owns_work) = join_thumbnail_job(&key).unwrap();
        assert!(owns_work);
        let completion = ThumbnailCompletion {
            key: key.clone(),
            job: job.clone(),
            completed: false,
        };
        let waiter = std::thread::spawn(move || wait_for_thumbnail(&job));
        drop(completion);
        assert!(waiter.join().unwrap().unwrap_err().contains("interrupted"));
        assert!(!thumbnail_jobs().lock().unwrap().contains_key(&key));
        assert_eq!(
            coalesce_thumbnail(key, || Err("new attempt".to_string())).unwrap_err(),
            "new attempt"
        );
    }
}
