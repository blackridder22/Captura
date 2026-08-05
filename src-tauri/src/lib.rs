mod database;
mod platform;
#[cfg(target_os = "macos")]
mod smoke;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicIsize, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use database::{CaptureItem, Database, DatabaseError, ItemKind, ItemStatus, Section};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg(target_os = "macos")]
use platform::macos::{self, ActiveApplication, CapturedSelection};

const APP_BUNDLE_ID: &str = "com.autoscale.captura";
const GLOBAL_SHORTCUT: &str = "Alt+Space";
const SHORTCUTS_SETTING: &str = "keyboard_shortcuts";
const KEEP_OPEN_SETTING: &str = "keep_open";
const ACCESSIBILITY_SETUP_SEEN_SETTING: &str = "accessibility_setup_seen";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct KeyboardShortcuts {
    capture: String,
    capture_clipboard: String,
    save: String,
    paste: String,
    search: String,
    close: String,
    settings: String,
    dismiss: String,
    next: String,
    previous: String,
    copy: String,
    copy_as_list: String,
    mark_done: String,
    edit: String,
    merge: String,
    delete: String,
}

impl Default for KeyboardShortcuts {
    fn default() -> Self {
        Self {
            capture: GLOBAL_SHORTCUT.to_string(),
            capture_clipboard: "Alt+Shift+Space".to_string(),
            save: "Command+Enter".to_string(),
            paste: "Command+Enter".to_string(),
            search: "Command+F".to_string(),
            close: "Command+W".to_string(),
            settings: if cfg!(target_os = "macos") {
                "Command+,"
            } else {
                "Control+,"
            }
            .to_string(),
            dismiss: "Escape".to_string(),
            next: "ArrowDown".to_string(),
            previous: "ArrowUp".to_string(),
            copy: "Command+C".to_string(),
            copy_as_list: "Shift+Command+C".to_string(),
            mark_done: "Space".to_string(),
            edit: "Enter".to_string(),
            merge: "Shift+Command+M".to_string(),
            delete: "Command+Backspace".to_string(),
        }
    }
}

impl KeyboardShortcuts {
    fn get(&self, action: &str) -> Option<&str> {
        match action {
            "capture" => Some(&self.capture),
            "captureClipboard" => Some(&self.capture_clipboard),
            "save" => Some(&self.save),
            "paste" => Some(&self.paste),
            "search" => Some(&self.search),
            "close" => Some(&self.close),
            "settings" => Some(&self.settings),
            "dismiss" => Some(&self.dismiss),
            "next" => Some(&self.next),
            "previous" => Some(&self.previous),
            "copy" => Some(&self.copy),
            "copyAsList" => Some(&self.copy_as_list),
            "markDone" => Some(&self.mark_done),
            "edit" => Some(&self.edit),
            "merge" => Some(&self.merge),
            "delete" => Some(&self.delete),
            _ => None,
        }
    }

    fn set(&mut self, action: &str, shortcut: String) -> Result<(), String> {
        let target = match action {
            "capture" => &mut self.capture,
            "captureClipboard" => &mut self.capture_clipboard,
            "save" => &mut self.save,
            "paste" => &mut self.paste,
            "search" => &mut self.search,
            "close" => &mut self.close,
            "settings" => &mut self.settings,
            "dismiss" => &mut self.dismiss,
            "next" => &mut self.next,
            "previous" => &mut self.previous,
            "copy" => &mut self.copy,
            "copyAsList" => &mut self.copy_as_list,
            "markDone" => &mut self.mark_done,
            "edit" => &mut self.edit,
            "merge" => &mut self.merge,
            "delete" => &mut self.delete,
            _ => return Err("Unknown shortcut action".to_string()),
        };
        *target = shortcut;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    shortcuts: KeyboardShortcuts,
    keep_open: bool,
}

struct AppState {
    database: Database,
    previous_application: Mutex<Option<ActiveApplication>>,
    shortcuts: Mutex<KeyboardShortcuts>,
    shortcut_registered: AtomicBool,
    pasteboard_change_seen: AtomicIsize,
    main_window_has_focused: AtomicBool,
    keep_open: AtomicBool,
    accessibility_setup_seen: AtomicBool,
}

impl AppState {
    fn new() -> Result<Self, String> {
        let database_path = database_path()?;
        let database_existed = database_path.exists();
        let database = Database::open(&database_path).map_err(|error| error.to_string())?;
        let stored_shortcuts = database
            .setting(SHORTCUTS_SETTING)
            .map_err(|error| error.to_string())?;
        let mut shortcuts: KeyboardShortcuts = stored_shortcuts
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok())
            .unwrap_or_default();
        if stored_shortcuts.is_none() {
            if let Some(legacy_capture_shortcut) = database
                .setting("capture_shortcut")
                .map_err(|error| error.to_string())?
            {
                shortcuts.capture = legacy_capture_shortcut;
            }
        }
        let keep_open = database
            .setting(KEEP_OPEN_SETTING)
            .map_err(|error| error.to_string())?
            .is_some_and(|value| value == "true");
        let accessibility_setup_seen = load_accessibility_setup_seen(&database, database_existed)?;
        Ok(Self {
            database,
            previous_application: Mutex::new(None),
            shortcuts: Mutex::new(shortcuts),
            shortcut_registered: AtomicBool::new(false),
            pasteboard_change_seen: AtomicIsize::new(0),
            main_window_has_focused: AtomicBool::new(false),
            keep_open: AtomicBool::new(keep_open),
            accessibility_setup_seen: AtomicBool::new(accessibility_setup_seen),
        })
    }
}

fn load_accessibility_setup_seen(
    database: &Database,
    database_existed: bool,
) -> Result<bool, String> {
    match database
        .setting(ACCESSIBILITY_SETUP_SEEN_SETTING)
        .map_err(|error| error.to_string())?
    {
        Some(value) => Ok(value == "true"),
        None if database_existed => {
            database
                .set_setting(ACCESSIBILITY_SETUP_SEEN_SETTING, "true")
                .map_err(|error| error.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionStatus {
    accessibility_trusted: bool,
    post_event_trusted: bool,
    global_shortcut_registered: bool,
    setup_seen: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CopyMode {
    Native,
    SourceMarkdown,
    MarkdownList,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum CopyFormat {
    Markdown,
    MarkdownList,
    Image,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyResult {
    format: CopyFormat,
    count: usize,
}

#[derive(Debug, PartialEq, Eq)]
enum CopyPayload {
    Text {
        content: String,
        format: CopyFormat,
        count: usize,
    },
    Image {
        path: PathBuf,
    },
}

#[derive(Debug, PartialEq, Eq)]
enum PastePayload {
    Text(String),
    Image(PathBuf),
}

enum ReadyPastePayload {
    Text(String),
    Image(Vec<u8>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum PermissionOperation {
    Capture,
    Paste,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionRequiredEvent {
    operation: PermissionOperation,
    accessibility_trusted: bool,
    post_event_trusted: bool,
}

fn database_path() -> Result<PathBuf, String> {
    let directories = ProjectDirs::from("com", "Auto Scale Agency", "Captura")
        .ok_or_else(|| "could not resolve Captura's application data directory".to_string())?;
    Ok(directories.data_dir().join("captura.db"))
}

fn infer_kind(content: &str) -> ItemKind {
    let trimmed = content.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return ItemKind::Link;
    }

    let lowercase = trimmed.to_lowercase();
    let prompt_prefixes = [
        "ask ",
        "compare ",
        "create ",
        "draft ",
        "explain ",
        "find ",
        "give ",
        "rewrite ",
        "summarize ",
        "turn ",
        "write ",
    ];
    if trimmed.ends_with('?')
        || prompt_prefixes
            .iter()
            .any(|prefix| lowercase.starts_with(prefix))
    {
        ItemKind::Prompt
    } else {
        ItemKind::Note
    }
}

fn collapse_newlines_for_list(content: &str) -> String {
    let mut collapsed = String::new();
    let mut in_newline = false;
    for character in content.trim().chars() {
        if matches!(character, '\n' | '\r') {
            if !in_newline {
                collapsed.push(' ');
            }
            in_newline = true;
        } else {
            collapsed.push(character);
            in_newline = false;
        }
    }
    collapsed
}

fn build_copy_payload(items: &[CaptureItem], mode: CopyMode) -> Result<CopyPayload, String> {
    if items.is_empty() {
        return Err("Select at least one capture to copy.".to_string());
    }

    match mode {
        CopyMode::Native => {
            if items.len() != 1 {
                return Err("Native copy supports one capture at a time.".to_string());
            }
            let item = &items[0];
            if item.kind == ItemKind::Image {
                let path = item
                    .attachment_path
                    .as_deref()
                    .filter(|path| !path.trim().is_empty())
                    .ok_or_else(|| "This image capture has no stored file.".to_string())?;
                Ok(CopyPayload::Image {
                    path: PathBuf::from(path),
                })
            } else {
                Ok(CopyPayload::Text {
                    content: item.content.clone(),
                    format: CopyFormat::Markdown,
                    count: 1,
                })
            }
        }
        CopyMode::SourceMarkdown | CopyMode::MarkdownList => {
            if items.iter().any(|item| item.kind == ItemKind::Image) {
                return Err("Select only text captures to copy Markdown.".to_string());
            }
            let content = match mode {
                CopyMode::SourceMarkdown => items
                    .iter()
                    .map(|item| item.content.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n"),
                CopyMode::MarkdownList => items
                    .iter()
                    .map(|item| format!("- {}", collapse_newlines_for_list(&item.content)))
                    .collect::<Vec<_>>()
                    .join("\n"),
                CopyMode::Native => unreachable!(),
            };
            Ok(CopyPayload::Text {
                content,
                format: if mode == CopyMode::SourceMarkdown {
                    CopyFormat::Markdown
                } else {
                    CopyFormat::MarkdownList
                },
                count: items.len(),
            })
        }
    }
}

fn build_paste_payload(item: &CaptureItem) -> Result<PastePayload, String> {
    if item.kind == ItemKind::Image {
        let path = item
            .attachment_path
            .as_deref()
            .filter(|path| !path.trim().is_empty())
            .ok_or_else(|| "This image capture has no stored file.".to_string())?;
        Ok(PastePayload::Image(PathBuf::from(path)))
    } else {
        Ok(PastePayload::Text(item.content.clone()))
    }
}

#[tauri::command]
fn list_items(state: State<'_, AppState>) -> Result<Vec<CaptureItem>, String> {
    state
        .database
        .list_items()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_item(
    state: State<'_, AppState>,
    content: String,
    kind: ItemKind,
    source_app: Option<String>,
) -> Result<CaptureItem, String> {
    state
        .database
        .create_item(&content, kind, source_app.as_deref(), None, None)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_item(
    state: State<'_, AppState>,
    id: String,
    content: String,
    kind: ItemKind,
) -> Result<CaptureItem, String> {
    state
        .database
        .update_item(&id, &content, kind)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_item(state: State<'_, AppState>, id: String) -> Result<CaptureItem, String> {
    state
        .database
        .toggle_item(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_item(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let attachment = state
        .database
        .get_item(&id)
        .ok()
        .and_then(|item| item.attachment_path);
    state
        .database
        .delete_item(&id)
        .map_err(|error| error.to_string())?;
    if let Some(path) = attachment {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
fn copy_items(
    state: State<'_, AppState>,
    ids: Vec<String>,
    mode: CopyMode,
) -> Result<CopyResult, String> {
    let items = ids
        .iter()
        .map(|id| state.database.get_item(id))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    match build_copy_payload(&items, mode)? {
        CopyPayload::Text {
            content,
            format,
            count,
        } => {
            macos::write_clipboard_markdown(&content).map_err(|error| error.to_string())?;
            Ok(CopyResult { format, count })
        }
        CopyPayload::Image { path } => {
            let png = std::fs::read(&path)
                .map_err(|_| "The image file for this capture is missing.".to_string())?;
            macos::write_clipboard_image(&png).map_err(|error| error.to_string())?;
            Ok(CopyResult {
                format: CopyFormat::Image,
                count: 1,
            })
        }
    }
}

#[tauri::command]
fn import_image_files(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<CaptureItem>, String> {
    let mut imported = Vec::new();
    for path in paths {
        let source = PathBuf::from(&path);
        let Ok(bytes) = std::fs::read(&source) else {
            continue;
        };
        // Normalizing through AppKit both converts the format and rejects
        // non-image files in one step.
        let Some(png) = macos::normalize_image_to_png(&bytes) else {
            continue;
        };
        let label = source
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .filter(|stem| !stem.trim().is_empty())
            .unwrap_or_else(|| "Image".to_string());
        let item = create_image_capture(&state, &png, &label, None, None)?;
        let _ = app.emit("captura://captured", &item);
        imported.push(item);
    }
    if imported.is_empty() {
        return Err("No images found in the dropped files.".to_string());
    }
    Ok(imported)
}

#[tauri::command]
fn list_sections(state: State<'_, AppState>) -> Result<Vec<Section>, String> {
    state
        .database
        .list_sections()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_section(state: State<'_, AppState>, name: String) -> Result<Section, String> {
    state
        .database
        .create_section(&name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_section(state: State<'_, AppState>, id: String) -> Result<Vec<CaptureItem>, String> {
    match state.database.delete_section(&id) {
        Ok(items) => Ok(items),
        Err(DatabaseError::NotFound) => Err("Section not found.".to_string()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn move_items_to_section(
    state: State<'_, AppState>,
    ids: Vec<String>,
    section_id: Option<String>,
) -> Result<Vec<CaptureItem>, String> {
    state
        .database
        .move_items_to_section(&ids, section_id.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn merge_items(state: State<'_, AppState>, ids: Vec<String>) -> Result<CaptureItem, String> {
    state
        .database
        .merge_items(&ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn paste_item(app: AppHandle, id: String) -> Result<CaptureItem, String> {
    if let Some(requirement) = live_permission_requirement(PermissionOperation::Paste) {
        show_permission_repair(&app, requirement);
        return Err("Accessibility is required to paste back.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let item = state
            .database
            .get_item(&id)
            .map_err(|error| error.to_string())?;
        let target = state
            .previous_application
            .lock()
            .map_err(|_| "previous application lock was poisoned".to_string())?
            .clone()
            .ok_or_else(|| {
                "No target app yet. Click into the app you want to paste into, then come back."
                    .to_string()
            })?;

        let payload = match build_paste_payload(&item)? {
            PastePayload::Text(content) => ReadyPastePayload::Text(content),
            PastePayload::Image(path) => ReadyPastePayload::Image(
                std::fs::read(path)
                    .map_err(|_| "The image file for this capture is missing.".to_string())?,
            ),
        };

        if !state.keep_open.load(Ordering::Relaxed) {
            hide_window(&app, "main");
        }
        match payload {
            ReadyPastePayload::Text(content) => {
                macos::paste_markdown(&content, &target).map_err(|error| error.to_string())?;
            }
            ReadyPastePayload::Image(png) => {
                macos::paste_image(&png, &target).map_err(|error| error.to_string())?;
            }
        }
        state
            .database
            .set_status(&id, ItemStatus::Done)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn hide_main_window(app: AppHandle) {
    hide_window(&app, "main");
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    present_main_window(&app, false);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn current_permission_status(state: &AppState) -> PermissionStatus {
    PermissionStatus {
        accessibility_trusted: macos::accessibility_trusted(),
        post_event_trusted: macos::post_event_trusted(),
        global_shortcut_registered: state.shortcut_registered.load(Ordering::Relaxed),
        setup_seen: state.accessibility_setup_seen.load(Ordering::Relaxed),
    }
}

fn permission_requirement(
    operation: PermissionOperation,
    accessibility_trusted: bool,
    post_event_trusted: bool,
) -> Option<PermissionRequiredEvent> {
    let unavailable = match operation {
        PermissionOperation::Capture => !accessibility_trusted || !post_event_trusted,
        PermissionOperation::Paste => !post_event_trusted,
    };
    unavailable.then_some(PermissionRequiredEvent {
        operation,
        accessibility_trusted,
        post_event_trusted,
    })
}

fn live_permission_requirement(operation: PermissionOperation) -> Option<PermissionRequiredEvent> {
    permission_requirement(
        operation,
        macos::accessibility_trusted(),
        macos::post_event_trusted(),
    )
}

fn show_permission_repair(app: &AppHandle, requirement: PermissionRequiredEvent) {
    present_main_window(app, false);
    let _ = app.emit("captura://permission-required", requirement);
}

#[tauri::command]
fn permission_status(state: State<'_, AppState>) -> PermissionStatus {
    current_permission_status(&state)
}

#[tauri::command]
fn mark_accessibility_setup_seen(state: State<'_, AppState>) -> Result<PermissionStatus, String> {
    state
        .database
        .set_setting(ACCESSIBILITY_SETUP_SEEN_SETTING, "true")
        .map_err(|error| error.to_string())?;
    state
        .accessibility_setup_seen
        .store(true, Ordering::Relaxed);
    Ok(current_permission_status(&state))
}

fn current_app_settings(state: &AppState) -> Result<AppSettings, String> {
    Ok(AppSettings {
        shortcuts: state
            .shortcuts
            .lock()
            .map_err(|_| "shortcut lock was poisoned".to_string())?
            .clone(),
        keep_open: state.keep_open.load(Ordering::Relaxed),
    })
}

#[tauri::command]
fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    current_app_settings(&state)
}

fn persist_shortcuts(state: &AppState, shortcuts: &KeyboardShortcuts) -> Result<(), String> {
    let serialized = serde_json::to_string(shortcuts).map_err(|error| error.to_string())?;
    state
        .database
        .set_setting(SHORTCUTS_SETTING, &serialized)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    action: String,
    shortcut: String,
) -> Result<AppSettings, String> {
    let shortcut = shortcut.trim().to_string();
    if shortcut.is_empty() || shortcut.len() > 96 {
        return Err("Choose a valid keyboard shortcut".to_string());
    }

    let mut shortcuts = state
        .shortcuts
        .lock()
        .map_err(|_| "shortcut lock was poisoned".to_string())?;
    let current = shortcuts
        .get(&action)
        .ok_or_else(|| "Unknown shortcut action".to_string())?
        .to_string();
    if current == shortcut {
        if is_global_action(&action) {
            let registered = app.global_shortcut().register(shortcut.as_str());
            if action == "capture" && registered.is_ok() {
                state.shortcut_registered.store(true, Ordering::Relaxed);
            }
        }
        drop(shortcuts);
        return current_app_settings(&state);
    }

    if is_global_action(&action) {
        app.global_shortcut()
            .register(shortcut.as_str())
            .map_err(|error| format!("That global shortcut is unavailable: {error}"))?;
        if let Err(error) = app.global_shortcut().unregister(current.as_str()) {
            let _ = app.global_shortcut().unregister(shortcut.as_str());
            return Err(error.to_string());
        }
    }

    let previous = shortcuts.clone();
    shortcuts.set(&action, shortcut.clone())?;
    if let Err(error) = persist_shortcuts(&state, &shortcuts) {
        *shortcuts = previous;
        if is_global_action(&action) {
            let _ = app.global_shortcut().unregister(shortcut.as_str());
            let _ = app.global_shortcut().register(current.as_str());
        }
        return Err(error);
    }
    drop(shortcuts);

    if action == "capture" {
        state.shortcut_registered.store(true, Ordering::Relaxed);
    }
    current_app_settings(&state)
}

#[tauri::command]
fn reset_shortcuts(app: AppHandle, state: State<'_, AppState>) -> Result<AppSettings, String> {
    let defaults = KeyboardShortcuts::default();
    let mut shortcuts = state
        .shortcuts
        .lock()
        .map_err(|_| "shortcut lock was poisoned".to_string())?;
    let swaps = [
        (shortcuts.capture.clone(), defaults.capture.clone()),
        (
            shortcuts.capture_clipboard.clone(),
            defaults.capture_clipboard.clone(),
        ),
    ];

    let mut swapped: Vec<&(String, String)> = Vec::new();
    for swap in &swaps {
        let (current, default) = swap;
        if current == default {
            continue;
        }
        if let Err(error) = app
            .global_shortcut()
            .register(default.as_str())
            .map_err(|error| format!("The default global shortcut is unavailable: {error}"))
            .and_then(|()| {
                app.global_shortcut()
                    .unregister(current.as_str())
                    .map_err(|error| error.to_string())
            })
        {
            // Roll back everything swapped so far.
            let _ = app.global_shortcut().unregister(default.as_str());
            for (current, default) in swapped {
                let _ = app.global_shortcut().unregister(default.as_str());
                let _ = app.global_shortcut().register(current.as_str());
            }
            return Err(error);
        }
        swapped.push(swap);
    }

    if let Err(error) = persist_shortcuts(&state, &defaults) {
        for (current, default) in swapped {
            let _ = app.global_shortcut().unregister(default.as_str());
            let _ = app.global_shortcut().register(current.as_str());
        }
        return Err(error);
    }
    *shortcuts = defaults;
    drop(shortcuts);
    state.shortcut_registered.store(true, Ordering::Relaxed);
    current_app_settings(&state)
}

#[tauri::command]
fn set_keep_open(state: State<'_, AppState>, keep_open: bool) -> Result<AppSettings, String> {
    state
        .database
        .set_setting(KEEP_OPEN_SETTING, if keep_open { "true" } else { "false" })
        .map_err(|error| error.to_string())?;
    state.keep_open.store(keep_open, Ordering::Relaxed);
    current_app_settings(&state)
}

#[tauri::command]
fn capture_clipboard_now(app: AppHandle) {
    capture_clipboard(&app);
}

fn capture_clipboard_action(app: AppHandle) {
    capture_clipboard(&app);
}

fn matches_registered_shortcut(
    pressed: &tauri_plugin_global_shortcut::Shortcut,
    configured: &str,
) -> bool {
    configured
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map(|shortcut| shortcut == *pressed)
        .unwrap_or(false)
}

fn is_global_action(action: &str) -> bool {
    matches!(action, "capture" | "captureClipboard")
}

#[tauri::command]
fn request_accessibility() -> bool {
    macos::request_accessibility()
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    macos::open_accessibility_settings().map_err(|error| error.to_string())
}

fn store_previous_application(app: &AppHandle, active: ActiveApplication) {
    if active.bundle_id.as_deref() == Some(APP_BUNDLE_ID) {
        return;
    }

    let state = app.state::<AppState>();
    if let Ok(mut previous) = state.previous_application.lock() {
        *previous = Some(active);
    };
}

fn remember_frontmost_application(app: &AppHandle) {
    let Ok(active) = macos::frontmost_application() else {
        return;
    };
    store_previous_application(app, active);
}

fn handle_global_capture(app: AppHandle) {
    if let Some(requirement) = live_permission_requirement(PermissionOperation::Capture) {
        show_permission_repair(&app, requirement);
        return;
    }

    remember_frontmost_application(&app);
    let previous = app
        .state::<AppState>()
        .previous_application
        .lock()
        .ok()
        .and_then(|application| application.clone());

    // Screenshot workflow: the user copies an image (⌃⇧⌘4 etc.) and hits the
    // shortcut with nothing selected. The selection dance below can't see
    // that, so note whether the clipboard changed since we last looked —
    // a fresh image with no selection IS the capture.
    let clipboard_is_fresh = macos::pasteboard_change_count()
        != app
            .state::<AppState>()
            .pasteboard_change_seen
            .load(Ordering::Relaxed);

    match macos::copy_selection(previous.as_ref()) {
        Ok(Some(selection)) => {
            let state = app.state::<AppState>();
            let source_app = previous
                .as_ref()
                .map(|application| application.name.as_str());
            let source_bundle_id = previous
                .as_ref()
                .and_then(|application| application.bundle_id.as_deref());
            let result = match selection {
                CapturedSelection::Text(content) => state
                    .database
                    .create_item(
                        &content,
                        infer_kind(&content),
                        source_app,
                        source_bundle_id,
                        None,
                    )
                    .map_err(|error| error.to_string()),
                CapturedSelection::Image(png) => create_image_capture(
                    &state,
                    &png,
                    "Image capture",
                    source_app,
                    source_bundle_id,
                ),
            };

            if let Ok(item) = result {
                let _ = app.emit("captura://captured", &item);
                show_capture_hud(&app, &item);
            }
        }
        Ok(None) => {
            let fresh_image = clipboard_is_fresh
                .then(macos::clipboard_image_png)
                .flatten();
            match fresh_image {
                Some(png) => {
                    let state = app.state::<AppState>();
                    let result = create_image_capture(
                        &state,
                        &png,
                        "Image capture",
                        previous
                            .as_ref()
                            .map(|application| application.name.as_str()),
                        previous
                            .as_ref()
                            .and_then(|application| application.bundle_id.as_deref()),
                    );
                    if let Ok(item) = result {
                        let _ = app.emit("captura://captured", &item);
                        show_capture_hud(&app, &item);
                    }
                }
                None => present_main_window(&app, true),
            }
        }
        Err(_) => {
            if let Some(requirement) = live_permission_requirement(PermissionOperation::Capture) {
                show_permission_repair(&app, requirement);
            } else {
                present_main_window(&app, true);
            }
        }
    }

    // Whatever happened, the current clipboard state is now "seen" — the
    // same image won't re-capture on the next empty-selection shortcut.
    app.state::<AppState>()
        .pasteboard_change_seen
        .store(macos::pasteboard_change_count(), Ordering::Relaxed);
}

fn capture_clipboard(app: &AppHandle) {
    remember_frontmost_application(app);
    let state = app.state::<AppState>();
    let previous = state
        .previous_application
        .lock()
        .ok()
        .and_then(|application| application.clone());
    let source_app = previous
        .as_ref()
        .map(|application| application.name.as_str());
    let source_bundle_id = previous
        .as_ref()
        .and_then(|application| application.bundle_id.as_deref());

    let result = match macos::clipboard_text().filter(|text| !text.trim().is_empty()) {
        Some(content) => state
            .database
            .create_item(
                &content,
                infer_kind(&content),
                source_app,
                source_bundle_id,
                None,
            )
            .map_err(|error| error.to_string()),
        None => match macos::clipboard_image_png() {
            Some(png) => {
                create_image_capture(&state, &png, "Image capture", source_app, source_bundle_id)
            }
            None => {
                present_main_window(app, true);
                return;
            }
        },
    };

    if let Ok(item) = result {
        let _ = app.emit("captura://captured", &item);
        show_capture_hud(app, &item);
    }
}

fn attachments_dir() -> Result<PathBuf, String> {
    let database = database_path()?;
    let parent = database
        .parent()
        .ok_or_else(|| "could not resolve Captura's data directory".to_string())?;
    let dir = parent.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn create_image_capture(
    state: &AppState,
    png: &[u8],
    label: &str,
    source_app: Option<&str>,
    source_bundle_id: Option<&str>,
) -> Result<CaptureItem, String> {
    let path = attachments_dir()?.join(format!("capture-{}.png", uuid::Uuid::new_v4()));
    std::fs::write(&path, png).map_err(|error| error.to_string())?;

    let result = state
        .database
        .create_item(
            label,
            ItemKind::Image,
            source_app,
            source_bundle_id,
            Some(&path.to_string_lossy()),
        )
        .map_err(|error| error.to_string());
    if result.is_err() {
        let _ = std::fs::remove_file(&path);
    }
    result
}

fn present_main_window(app: &AppHandle, focus_composer: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    app.state::<AppState>()
        .main_window_has_focused
        .store(false, Ordering::Relaxed);
    position_window_at_menu_bar(&window, 14);
    let _ = window.show();
    #[cfg(target_os = "macos")]
    let _ = macos::present_overlay_window(&window, true);
    if focus_composer {
        let _ = window.emit("captura://focus-composer", ());
    }
}

fn show_capture_hud(app: &AppHandle, item: &CaptureItem) {
    let Some(window) = app.get_webview_window("capture-hud") else {
        return;
    };
    position_window_at_menu_bar(&window, 18);
    let _ = window.emit("captura://hud", item);
    let _ = window.show();
    #[cfg(target_os = "macos")]
    let _ = macos::present_overlay_window(&window, false);

    let hud = window.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(1450));
        let _ = hud.hide();
    });
}

fn hide_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
    }
}

fn position_window_at_menu_bar(window: &WebviewWindow, right_margin: i32) {
    let monitor = window
        .cursor_position()
        .ok()
        .and_then(|position| {
            window
                .monitor_from_point(position.x, position.y)
                .ok()
                .flatten()
        })
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let work_area = monitor.work_area();
    let Ok(size) = window.outer_size() else {
        return;
    };
    let x = work_area.position.x + work_area.size.width as i32 - size.width as i32 - right_margin;
    let y = work_area.position.y + 4;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn tray_icon() -> Image<'static> {
    // Retina template glyph (viewfinder brackets + capture dot), recolored
    // automatically by macOS for light/dark menu bars.
    Image::from_bytes(include_bytes!("../icons/tray@2x.png"))
        .expect("tray icon asset is a valid PNG")
}

pub fn run() {
    let state = AppState::new().expect("failed to initialize Captura");

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let (capture, capture_clipboard) = {
                        let state = app.state::<AppState>();
                        let shortcuts = state.shortcuts.lock();
                        match shortcuts {
                            Ok(shortcuts) => (
                                shortcuts.capture.clone(),
                                shortcuts.capture_clipboard.clone(),
                            ),
                            Err(_) => return,
                        }
                    };
                    let handle = app.clone();
                    if matches_registered_shortcut(shortcut, &capture_clipboard) {
                        thread::spawn(move || capture_clipboard_action(handle));
                    } else if matches_registered_shortcut(shortcut, &capture) {
                        thread::spawn(move || handle_global_capture(handle));
                    }
                })
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory)?;

            for label in ["main", "capture-hud"] {
                if let Some(window) = app.get_webview_window(label) {
                    let _ = window.set_visible_on_all_workspaces(true);
                    #[cfg(target_os = "macos")]
                    macos::configure_overlay_window(&window)?;
                }
            }

            TrayIconBuilder::with_id("captura-tray")
                .icon(tray_icon())
                .icon_as_template(true)
                .tooltip("Captura")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        remember_frontmost_application(tray.app_handle());
                        present_main_window(tray.app_handle(), false);
                    }
                })
                .build(app)?;

            let (capture_shortcut, clipboard_shortcut) = app
                .state::<AppState>()
                .shortcuts
                .lock()
                .map(|shortcuts| {
                    (
                        shortcuts.capture.clone(),
                        shortcuts.capture_clipboard.clone(),
                    )
                })
                .unwrap_or_else(|_| (GLOBAL_SHORTCUT.to_string(), "Alt+Shift+Space".to_string()));
            let registered = app
                .global_shortcut()
                .register(capture_shortcut.as_str())
                .is_ok();
            app.state::<AppState>()
                .shortcut_registered
                .store(registered, Ordering::Relaxed);
            let _ = app.global_shortcut().register(clipboard_shortcut.as_str());

            // The paste target must be "the app the user was just working in",
            // not "the app that was frontmost when Captura opened" — with the
            // keep-open panel the user switches apps while Captura stays
            // visible, so the target has to follow them continuously. The
            // activation notification only fires on the NEXT switch, so seed
            // the current frontmost app first.
            remember_frontmost_application(app.handle());
            // Whatever is on the clipboard at launch predates Captura — mark
            // it seen so it never auto-captures.
            app.state::<AppState>()
                .pasteboard_change_seen
                .store(macos::pasteboard_change_count(), Ordering::Relaxed);
            let handle = app.handle().clone();
            match objc2::MainThreadMarker::new() {
                Some(main_thread) => {
                    macos::observe_frontmost_application(main_thread, move |active| {
                        store_previous_application(&handle, active);
                    });
                }
                None => {
                    // .setup() runs on the main thread, so this arm is
                    // effectively dead — but degrading to the old poller
                    // beats silently losing paste targeting.
                    thread::spawn(move || loop {
                        remember_frontmost_application(&handle);
                        thread::sleep(Duration::from_millis(350));
                    });
                }
            }

            #[cfg(target_os = "macos")]
            smoke::start_if_requested(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(focused) if window.label() == "main" => {
                let state = window.state::<AppState>();
                if *focused {
                    state.main_window_has_focused.store(true, Ordering::Relaxed);
                } else if !state.keep_open.load(Ordering::Relaxed)
                    && state.main_window_has_focused.swap(false, Ordering::Relaxed)
                {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            list_items,
            create_item,
            update_item,
            toggle_item,
            delete_item,
            copy_items,
            import_image_files,
            list_sections,
            create_section,
            delete_section,
            move_items_to_section,
            merge_items,
            paste_item,
            hide_main_window,
            show_main_window,
            quit_app,
            permission_status,
            mark_accessibility_setup_seen,
            get_app_settings,
            set_shortcut,
            reset_shortcuts,
            set_keep_open,
            capture_clipboard_now,
            request_accessibility,
            open_accessibility_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Captura");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn capture(id: &str, kind: ItemKind, content: &str, attachment: Option<&str>) -> CaptureItem {
        CaptureItem {
            id: id.to_string(),
            kind,
            content: content.to_string(),
            status: ItemStatus::Open,
            source_app: None,
            source_bundle_id: None,
            section_id: None,
            attachment_path: attachment.map(str::to_string),
            created_at: "2026-08-04T00:00:00Z".to_string(),
            updated_at: "2026-08-04T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn source_markdown_copy_preserves_every_byte_and_visible_order() {
        let first = capture(
            "first",
            ItemKind::Note,
            "# Heading\n\n- parent\n  - child\n\n[Link](https://example.com)",
            None,
        );
        let second = capture(
            "second",
            ItemKind::Prompt,
            "```rust\nfn main() {}\n```\n\nTrailing paragraph.",
            None,
        );

        let payload =
            build_copy_payload(&[first.clone(), second.clone()], CopyMode::SourceMarkdown)
                .expect("source markdown payload");
        assert_eq!(
            payload,
            CopyPayload::Text {
                content: format!("{}\n\n{}", first.content, second.content),
                format: CopyFormat::Markdown,
                count: 2,
            }
        );

        let native = build_copy_payload(std::slice::from_ref(&first), CopyMode::Native)
            .expect("native text payload");
        assert_eq!(
            native,
            CopyPayload::Text {
                content: first.content.clone(),
                format: CopyFormat::Markdown,
                count: 1,
            }
        );
        assert_eq!(
            build_paste_payload(&first).expect("text paste payload"),
            PastePayload::Text(first.content)
        );
    }

    #[test]
    fn markdown_list_copy_remains_deterministic() {
        let items = [
            capture("one", ItemKind::Note, "First\n\n  continuation", None),
            capture("two", ItemKind::Link, "Second\r\nline", None),
        ];
        assert_eq!(
            build_copy_payload(&items, CopyMode::MarkdownList).expect("list payload"),
            CopyPayload::Text {
                content: "- First   continuation\n- Second line".to_string(),
                format: CopyFormat::MarkdownList,
                count: 2,
            }
        );
    }

    #[test]
    fn image_and_mixed_copy_rules_are_explicit() {
        let image = capture(
            "image",
            ItemKind::Image,
            "Image capture",
            Some("/tmp/captura.png"),
        );
        let text = capture("text", ItemKind::Note, "Text", None);
        assert_eq!(
            build_copy_payload(std::slice::from_ref(&image), CopyMode::Native)
                .expect("image payload"),
            CopyPayload::Image {
                path: PathBuf::from("/tmp/captura.png"),
            }
        );
        assert_eq!(
            build_paste_payload(&image).expect("image paste payload"),
            PastePayload::Image(PathBuf::from("/tmp/captura.png"))
        );
        assert_eq!(
            build_copy_payload(&[text, image], CopyMode::SourceMarkdown),
            Err("Select only text captures to copy Markdown.".to_string())
        );
        let missing = capture("missing", ItemKind::Image, "Image capture", None);
        assert_eq!(
            build_copy_payload(&[missing], CopyMode::Native),
            Err("This image capture has no stored file.".to_string())
        );
    }

    #[test]
    fn permission_preflight_is_operation_specific() {
        assert!(permission_requirement(PermissionOperation::Capture, false, true).is_some());
        assert!(permission_requirement(PermissionOperation::Capture, true, false).is_some());
        assert!(permission_requirement(PermissionOperation::Capture, true, true).is_none());
        assert!(permission_requirement(PermissionOperation::Paste, false, true).is_none());
        assert!(permission_requirement(PermissionOperation::Paste, true, false).is_some());
    }

    #[test]
    fn accessibility_setup_seen_handles_fresh_and_existing_databases() {
        let directory = tempdir().expect("temporary directory");
        let fresh_path = directory.path().join("fresh.db");
        let fresh = Database::open(&fresh_path).expect("fresh database");
        assert!(!load_accessibility_setup_seen(&fresh, false).expect("fresh setup state"));
        fresh
            .set_setting(ACCESSIBILITY_SETUP_SEEN_SETTING, "true")
            .expect("mark setup seen");
        drop(fresh);
        let reopened = Database::open(&fresh_path).expect("reopen database");
        assert!(load_accessibility_setup_seen(&reopened, true).expect("persisted setup state"));

        let existing_path = directory.path().join("existing.db");
        let existing = Database::open(&existing_path).expect("existing database");
        assert!(load_accessibility_setup_seen(&existing, true).expect("upgrade setup state"));
        assert_eq!(
            existing
                .setting(ACCESSIBILITY_SETUP_SEEN_SETTING)
                .expect("persisted compatibility state")
                .as_deref(),
            Some("true")
        );
    }
}
