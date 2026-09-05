//! Bounded, local image import. Call this service from a blocking worker, never
//! from AppKit's main thread. Native clipboard/picker code only snapshots inputs.

use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime},
};

use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::platform::image_native;

pub const MAX_BATCH_FILES: usize = 20;
pub const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_BATCH_BYTES: u64 = 200 * 1024 * 1024;
pub const MAX_IMAGE_PIXELS: u64 = 40_000_000;
pub const MAX_IMAGE_EDGE: u32 = 16_384;
pub const THUMBNAIL_EDGE: u32 = 480;
const MAX_PENDING_REQUESTS: usize = 5; // One decoder and four waiting requests.
const CLEANUP_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug)]
pub enum ImageInput {
    File(PathBuf),
    Bytes {
        label: String,
        bytes: Vec<u8>,
    },
    /// A pasteboard item rejected before copying large data across threads.
    Rejected {
        label: String,
        error: ImageError,
    },
}

impl ImageInput {
    pub fn label(&self) -> String {
        match self {
            Self::File(path) => path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Image".to_string()),
            Self::Bytes { label, .. } | Self::Rejected { label, .. } => label.clone(),
        }
    }
}

#[derive(Debug)]
pub struct ImportRequest {
    pub request_id: String,
    /// Snapshotted when the user initiates the import, not when decoding ends.
    pub section_id: Option<String>,
    pub inputs: Vec<ImageInput>,
}

#[derive(Debug, Clone)]
pub struct ImageError {
    pub code: &'static str,
    pub message: String,
}

impl ImageError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn io(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => "file_missing",
            std::io::ErrorKind::PermissionDenied => "permission_denied",
            _ => "file_io",
        };
        Self::new(code, error.to_string())
    }
}

impl std::fmt::Display for ImageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.message.fmt(f)
    }
}

impl std::error::Error for ImageError {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportNotice {
    pub index: Option<usize>,
    pub name: Option<String>,
    pub code: String,
    pub message: String,
}

impl ImportNotice {
    fn item(index: usize, name: String, error: ImageError) -> Self {
        Self {
            index: Some(index),
            name: Some(name),
            code: error.code.to_string(),
            message: error.message,
        }
    }

    fn batch(code: &str, message: impl Into<String>) -> Self {
        Self {
            index: None,
            name: None,
            code: code.to_string(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchResult<T> {
    pub request_id: String,
    pub cancelled: bool,
    pub items: Vec<T>,
    pub issues: Vec<ImportNotice>,
    pub warnings: Vec<ImportNotice>,
}

impl<T> ImportBatchResult<T> {
    pub fn empty(request_id: String) -> Self {
        Self {
            request_id,
            cancelled: false,
            items: Vec::new(),
            issues: Vec::new(),
            warnings: Vec::new(),
        }
    }

    pub fn cancelled(request_id: String) -> Self {
        Self {
            cancelled: true,
            ..Self::empty(request_id)
        }
    }
}

/// Both files already exist durably when this is handed to the DB callback.
/// The callback must insert the capture and its section in one transaction.
#[derive(Debug)]
pub struct PreparedImage {
    /// Use batch_started_at minus this many nanoseconds for created_at, so a
    /// descending queue preserves input order even after a database reload.
    pub input_index: usize,
    pub batch_started_at: DateTime<Utc>,
    pub label: String,
    pub attachment_path: PathBuf,
    pub thumbnail_path: PathBuf,
    pub width: u32,
    pub height: u32,
}

pub struct Persisted<T> {
    pub item: T,
    /// True if a section selected at import start was deleted meanwhile.
    pub section_missing: bool,
}

#[derive(Debug)]
pub struct PreparedThumbnail {
    pub thumbnail_path: PathBuf,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Default)]
pub struct CleanupReport {
    pub removed_files: usize,
    pub removed_staging_directories: usize,
    pub errors: Vec<String>,
}

#[derive(Default)]
pub struct ImageImportService {
    decoder: Mutex<()>,
    pending: AtomicUsize,
}

struct PendingRequest<'a>(&'a AtomicUsize);

impl Drop for PendingRequest<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Release);
    }
}

impl ImageImportService {
    fn enter(&self) -> Result<PendingRequest<'_>, String> {
        self.pending
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < MAX_PENDING_REQUESTS).then_some(value + 1)
            })
            .map_err(|_| {
                "The image import queue is full. Try again after an import finishes.".to_string()
            })?;
        Ok(PendingRequest(&self.pending))
    }

    pub fn import_batch<T>(
        &self,
        request: ImportRequest,
        attachments: &Path,
        mut persist: impl FnMut(&PreparedImage, Option<&str>) -> Result<Persisted<T>, String>,
    ) -> Result<ImportBatchResult<T>, String> {
        let _pending = self.enter()?;
        let _decoder = self
            .decoder
            .lock()
            .map_err(|_| "The image worker is unavailable.".to_string())?;
        let mut result = ImportBatchResult::empty(request.request_id);
        if request.inputs.is_empty() {
            result.issues.push(ImportNotice::batch(
                "no_images",
                "No image pixels or local image files were supplied.",
            ));
            return Ok(result);
        }
        if request.inputs.len() > MAX_BATCH_FILES {
            result.issues.push(ImportNotice::batch(
                "too_many_files",
                "Choose at most 20 images at a time.",
            ));
            return Ok(result);
        }

        // Check size before decoding any file, so a batch cannot exceed its
        // aggregate memory/input budget simply by putting a large file last.
        let mut valid = Vec::with_capacity(request.inputs.len());
        let mut total_bytes = 0u64;
        let mut seen_paths = HashSet::new();
        for (index, input) in request.inputs.into_iter().enumerate() {
            let name = input.label();
            let inspected = match &input {
                ImageInput::File(path) => inspect_file(path).and_then(|size| {
                    let canonical = fs::canonicalize(path).map_err(ImageError::io)?;
                    if !seen_paths.insert(canonical) {
                        return Err(ImageError::new(
                            "duplicate_file",
                            "This file is already included in this import.",
                        ));
                    }
                    Ok(size)
                }),
                ImageInput::Bytes { bytes, .. } => check_file_size(bytes.len() as u64),
                ImageInput::Rejected { error, .. } => Err(error.clone()),
            };
            match inspected {
                Ok(size) => {
                    total_bytes = total_bytes.saturating_add(size);
                    valid.push((index, name, input));
                }
                Err(error) => result.issues.push(ImportNotice::item(index, name, error)),
            }
        }
        if total_bytes > MAX_BATCH_BYTES {
            result.issues.push(ImportNotice::batch(
                "batch_too_large",
                "The selected images exceed the 200 MiB batch limit.",
            ));
            return Ok(result);
        }
        if valid.is_empty() {
            return Ok(result);
        }
        create_private_directory(attachments).map_err(|error| error.to_string())?;
        let mut read_bytes = 0u64;
        let mut missing_section_reported = false;
        let batch_started_at = Utc::now();
        for (index, name, input) in valid {
            let imported = (|| {
                let bytes = match input {
                    ImageInput::File(path) => read_image_file(&path)?,
                    ImageInput::Bytes { bytes, .. } => bytes,
                    ImageInput::Rejected { error, .. } => return Err(error),
                };
                // Recheck after reading: a source file can grow between stat
                // and read, and must not turn a valid batch into an unbounded one.
                read_bytes = read_bytes.saturating_add(bytes.len() as u64);
                if read_bytes > MAX_BATCH_BYTES {
                    return Err(ImageError::new(
                        "batch_too_large",
                        "The source files changed and now exceed the 200 MiB batch limit.",
                    ));
                }
                let normalized = image_native::normalize(&bytes)?;
                drop(bytes);
                let mut staged =
                    StagedImage::write(attachments, &normalized.png, &normalized.thumbnail_png)?;
                let prepared = PreparedImage {
                    input_index: index,
                    batch_started_at,
                    label: image_label(&name),
                    attachment_path: staged.original.clone(),
                    thumbnail_path: staged.thumbnail.clone(),
                    width: normalized.width,
                    height: normalized.height,
                };
                // Decoding and file writes are finished before acquiring the
                // database lock in the callback.
                let persisted = persist(&prepared, request.section_id.as_deref())
                    .map_err(|error| ImageError::new("storage_failed", error))?;
                staged.committed = true;
                Ok((persisted, normalized.frame_count))
            })();
            match imported {
                Ok((persisted, frames)) => {
                    result.items.push(persisted.item);
                    if frames > 1 {
                        result.warnings.push(ImportNotice::item(
                            index,
                            name.clone(),
                            ImageError::new(
                                "first_frame_only",
                                "Only the first frame or page was captured.",
                            ),
                        ));
                    }
                    if persisted.section_missing && !missing_section_reported {
                        result.warnings.push(ImportNotice::batch(
                            "section_deleted",
                            "The selected section was deleted. Its images were saved to Unfiled.",
                        ));
                        missing_section_reported = true;
                    }
                }
                Err(error) => result.issues.push(ImportNotice::item(index, name, error)),
            }
        }
        result.issues.sort_by_key(|notice| notice.index);
        Ok(result)
    }

    /// Used on demand for pre-0.0.5 captures. Never rewrites their original.
    /// `persist` should update only if the item still points at this original.
    pub fn ensure_thumbnail<T>(
        &self,
        original: &Path,
        attachments: &Path,
        persist: impl FnOnce(&PreparedThumbnail) -> Result<T, String>,
    ) -> Result<T, String> {
        let _pending = self.enter()?;
        let _decoder = self
            .decoder
            .lock()
            .map_err(|_| "The image worker is unavailable.".to_string())?;
        let thumbnail =
            image_native::thumbnail_from_file(original).map_err(|error| error.to_string())?;
        create_private_directory(attachments).map_err(|error| error.to_string())?;
        let staged_dir = new_staging_directory(attachments).map_err(|error| error.to_string())?;
        let staged_file = staged_dir.join("thumbnail.png");
        let final_file = attachments.join(format!("capture-{}.thumb.png", Uuid::new_v4()));
        let generated = (|| {
            write_private_file(&staged_file, &thumbnail.png)?;
            fs::rename(&staged_file, &final_file)?;
            sync_directory(attachments)
        })();
        let _ = fs::remove_dir(&staged_dir);
        if let Err(error) = generated {
            let _ = fs::remove_file(&final_file);
            return Err(error.to_string());
        }
        let result = persist(&PreparedThumbnail {
            thumbnail_path: final_file.clone(),
            width: thumbnail.width,
            height: thumbnail.height,
        });
        if result.is_err() {
            let _ = fs::remove_file(final_file);
        }
        result
    }

    /// Run after first useful render, on the same blocking service. Restrict
    /// cleanup to names this service owns and files older than 24 hours.
    pub fn cleanup(
        &self,
        attachments: &Path,
        referenced_paths: &HashSet<PathBuf>,
    ) -> Result<CleanupReport, String> {
        let _pending = self.enter()?;
        let _decoder = self
            .decoder
            .lock()
            .map_err(|_| "The image worker is unavailable.".to_string())?;
        cleanup_at(
            attachments,
            referenced_paths,
            SystemTime::now(),
            CLEANUP_AGE,
        )
    }
}

fn image_label(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Image".to_string())
}

pub fn check_file_size(size: u64) -> Result<u64, ImageError> {
    if size == 0 {
        Err(ImageError::new("empty_file", "This image is empty."))
    } else if size > MAX_FILE_BYTES {
        Err(ImageError::new(
            "image_too_large",
            "This image exceeds the 50 MiB encoded file limit.",
        ))
    } else {
        Ok(size)
    }
}

pub fn validate_dimensions(width: u32, height: u32) -> Result<(), ImageError> {
    if width == 0 || height == 0 {
        return Err(ImageError::new(
            "invalid_dimensions",
            "The image has invalid dimensions.",
        ));
    }
    if width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE {
        return Err(ImageError::new(
            "image_dimensions_exceeded",
            "The image exceeds 16,384 pixels on one side.",
        ));
    }
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(ImageError::new(
            "image_pixels_exceeded",
            "The image exceeds 40 megapixels.",
        ));
    }
    Ok(())
}

fn inspect_file(path: &Path) -> Result<u64, ImageError> {
    let metadata = fs::metadata(path).map_err(ImageError::io)?;
    if !metadata.is_file() {
        return Err(ImageError::new(
            "not_a_file",
            "Choose a regular image file.",
        ));
    }
    check_file_size(metadata.len())
}

fn read_image_file(path: &Path) -> Result<Vec<u8>, ImageError> {
    let file = File::open(path).map_err(ImageError::io)?;
    let metadata = file.metadata().map_err(ImageError::io)?;
    if !metadata.is_file() {
        return Err(ImageError::new(
            "not_a_file",
            "Choose a regular image file.",
        ));
    }
    check_file_size(metadata.len())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(ImageError::io)?;
    check_file_size(bytes.len() as u64)?;
    Ok(bytes)
}

fn create_private_directory(path: &Path) -> std::io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

fn new_staging_directory(attachments: &Path) -> std::io::Result<PathBuf> {
    let path = attachments.join(format!(".staging-{}", Uuid::new_v4()));
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&path)?;
    Ok(path)
}

fn write_private_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn sync_directory(path: &Path) -> std::io::Result<()> {
    File::open(path)?.sync_all()
}

struct StagedImage {
    staging: PathBuf,
    original: PathBuf,
    thumbnail: PathBuf,
    committed: bool,
}

impl StagedImage {
    fn write(attachments: &Path, png: &[u8], thumbnail: &[u8]) -> Result<Self, ImageError> {
        let id = Uuid::new_v4();
        let result = Self {
            staging: new_staging_directory(attachments).map_err(ImageError::io)?,
            original: attachments.join(format!("capture-{id}.png")),
            thumbnail: attachments.join(format!("capture-{id}.thumb.png")),
            committed: false,
        };
        let staged_original = result.staging.join("original.png");
        let staged_thumbnail = result.staging.join("thumbnail.png");
        write_private_file(&staged_original, png).map_err(ImageError::io)?;
        write_private_file(&staged_thumbnail, thumbnail).map_err(ImageError::io)?;
        fs::rename(staged_original, &result.original).map_err(ImageError::io)?;
        fs::rename(staged_thumbnail, &result.thumbnail).map_err(ImageError::io)?;
        sync_directory(attachments).map_err(ImageError::io)?;
        Ok(result)
    }
}

impl Drop for StagedImage {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.original);
            let _ = fs::remove_file(&self.thumbnail);
        }
        let _ = fs::remove_dir_all(&self.staging);
    }
}

fn managed_png(name: &str) -> bool {
    name.strip_prefix("capture-")
        .and_then(|name| {
            name.strip_suffix(".thumb.png")
                .or_else(|| name.strip_suffix(".png"))
        })
        .is_some_and(|id| Uuid::parse_str(id).is_ok())
}

fn managed_staging(name: &str) -> bool {
    name.strip_prefix(".staging-")
        .is_some_and(|id| Uuid::parse_str(id).is_ok())
}

fn cleanup_at(
    attachments: &Path,
    referenced: &HashSet<PathBuf>,
    now: SystemTime,
    minimum_age: Duration,
) -> Result<CleanupReport, String> {
    let mut report = CleanupReport::default();
    if !attachments.exists() {
        return Ok(report);
    }
    for entry in fs::read_dir(attachments).map_err(|error| error.to_string())? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                report.errors.push(error.to_string());
                continue;
            }
        };
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if referenced.contains(&path) || !(managed_png(&name) || managed_staging(&name)) {
            continue;
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                report.errors.push(error.to_string());
                continue;
            }
        };
        // Never follow a link or traverse an unrelated subdirectory.
        if metadata.file_type().is_symlink() {
            continue;
        }
        let old_enough = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= minimum_age);
        if !old_enough {
            continue;
        }
        if metadata.is_file() && managed_png(&name) {
            match fs::remove_file(&path) {
                Ok(()) => report.removed_files += 1,
                Err(error) => report.errors.push(error.to_string()),
            }
        } else if metadata.is_dir() && managed_staging(&name) {
            match fs::remove_dir_all(&path) {
                Ok(()) => report.removed_staging_directories += 1,
                Err(error) => report.errors.push(error.to_string()),
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = include_bytes!("../tests/fixtures/images/alpha.png");

    fn request(inputs: Vec<ImageInput>) -> ImportRequest {
        ImportRequest {
            request_id: "image-test".to_string(),
            section_id: Some("selected-section".to_string()),
            inputs,
        }
    }

    #[test]
    fn batch_keeps_order_partial_success_and_reports_section_once() {
        let root = tempfile::tempdir().unwrap();
        let service = ImageImportService::default();
        let inputs = vec![
            ImageInput::Bytes {
                label: "one.png".to_string(),
                bytes: PNG.to_vec(),
            },
            ImageInput::Bytes {
                label: "corrupt.png".to_string(),
                bytes: b"broken".to_vec(),
            },
            ImageInput::Bytes {
                label: "three.png".to_string(),
                bytes: PNG.to_vec(),
            },
        ];
        let result = service
            .import_batch(request(inputs), root.path(), |image, section| {
                assert_eq!(section, Some("selected-section"));
                assert!(image.attachment_path.exists());
                assert!(image.thumbnail_path.exists());
                assert_eq!((image.width, image.height), (64, 32));
                Ok(Persisted {
                    item: image.label.clone(),
                    section_missing: true,
                })
            })
            .unwrap();
        assert_eq!(result.items, ["one", "three"]);
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].index, Some(1));
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(result.warnings[0].code, "section_deleted");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 4);
    }

    #[test]
    fn database_failure_rolls_back_original_and_thumbnail_without_ghost_capture() {
        let root = tempfile::tempdir().unwrap();
        let result = ImageImportService::default()
            .import_batch::<()>(
                request(vec![ImageInput::Bytes {
                    label: "image".to_string(),
                    bytes: PNG.to_vec(),
                }]),
                root.path(),
                |_, _| Err("simulated SQLite write failure".to_string()),
            )
            .unwrap();
        assert!(result.items.is_empty());
        assert_eq!(result.issues[0].code, "storage_failed");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[test]
    fn deduplicates_same_file_representations_and_names_missing_file() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        fs::write(&source, PNG).unwrap();
        let result = ImageImportService::default()
            .import_batch(
                request(vec![
                    ImageInput::File(source.clone()),
                    ImageInput::File(source),
                    ImageInput::File(root.path().join("missing.png")),
                ]),
                &root.path().join("attachments"),
                |image, _| {
                    Ok(Persisted {
                        item: image.label.clone(),
                        section_missing: false,
                    })
                },
            )
            .unwrap();
        assert_eq!(result.items.len(), 1);
        assert_eq!(
            result
                .issues
                .iter()
                .map(|issue| issue.code.as_str())
                .collect::<Vec<_>>(),
            ["duplicate_file", "file_missing"]
        );
    }

    #[test]
    fn rejects_oversized_batch_without_reading_or_persisting_it() {
        let root = tempfile::tempdir().unwrap();
        let mut inputs = Vec::new();
        for index in 0..5 {
            let path = root.path().join(format!("{index}.png"));
            File::create(&path)
                .unwrap()
                .set_len(MAX_FILE_BYTES)
                .unwrap();
            inputs.push(ImageInput::File(path));
        }
        let result = ImageImportService::default()
            .import_batch::<()>(request(inputs), &root.path().join("attachments"), |_, _| {
                panic!("must not persist")
            })
            .unwrap();
        assert!(result.items.is_empty());
        assert_eq!(result.issues[0].code, "batch_too_large");
        assert!(!root.path().join("attachments").exists());
    }

    #[test]
    fn legacy_thumbnail_failure_preserves_original_and_cleans_generated_file() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        fs::write(&source, PNG).unwrap();
        let attachments = root.path().join("attachments");
        let result =
            ImageImportService::default().ensure_thumbnail::<()>(&source, &attachments, |_| {
                Err("capture was deleted".to_string())
            });
        assert!(result.is_err());
        assert_eq!(fs::read(&source).unwrap(), PNG);
        assert_eq!(fs::read_dir(attachments).unwrap().count(), 0);
    }

    #[test]
    fn rejects_limits_before_decode_and_preserves_boundary_values() {
        assert!(check_file_size(MAX_FILE_BYTES).is_ok());
        assert!(check_file_size(MAX_FILE_BYTES + 1).is_err());
        assert!(check_file_size(0).is_err());
        assert!(validate_dimensions(8_000, 5_000).is_ok());
        assert!(validate_dimensions(8_001, 5_000).is_err());
        assert!(validate_dimensions(MAX_IMAGE_EDGE, 1).is_ok());
        assert!(validate_dimensions(MAX_IMAGE_EDGE + 1, 1).is_err());
    }

    #[test]
    fn cleanup_preserves_referenced_unmanaged_and_recent_files() {
        let root = tempfile::tempdir().unwrap();
        let live = root.path().join(format!("capture-{}.png", Uuid::new_v4()));
        let orphan = root
            .path()
            .join(format!("capture-{}.thumb.png", Uuid::new_v4()));
        let unrelated = root.path().join("capture-holiday.png");
        for path in [&live, &orphan, &unrelated] {
            fs::write(path, b"data").unwrap();
        }
        let staged = new_staging_directory(root.path()).unwrap();
        fs::write(staged.join("original.png"), b"partial").unwrap();
        let referenced = HashSet::from([live.clone()]);
        let recent = cleanup_at(root.path(), &referenced, SystemTime::now(), CLEANUP_AGE).unwrap();
        assert_eq!(recent.removed_files, 0);
        let old = cleanup_at(
            root.path(),
            &referenced,
            SystemTime::now() + CLEANUP_AGE + Duration::from_secs(1),
            CLEANUP_AGE,
        )
        .unwrap();
        assert_eq!(old.removed_files, 1);
        assert_eq!(old.removed_staging_directories, 1);
        assert!(live.exists());
        assert!(unrelated.exists());
        assert!(!orphan.exists());
        assert!(!staged.exists());
    }

    #[test]
    fn rollback_removes_both_atomic_files_and_staging_directory() {
        let root = tempfile::tempdir().unwrap();
        {
            let staged = StagedImage::write(root.path(), b"original", b"thumbnail").unwrap();
            assert!(staged.original.exists());
            assert!(staged.thumbnail.exists());
        }
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[test]
    fn service_bounds_pending_requests_and_releases_capacity() {
        let service = ImageImportService::default();
        let pending: Vec<_> = (0..MAX_PENDING_REQUESTS)
            .map(|_| service.enter().unwrap())
            .collect();
        assert!(service.enter().is_err());
        drop(pending);
        assert!(service.enter().is_ok());
    }
}
