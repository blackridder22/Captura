mod database;
mod platform;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use database::{CaptureItem, Database, ItemKind, ItemStatus, Section};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg(target_os = "macos")]
use platform::macos::{self, ActiveApplication};

const APP_BUNDLE_ID: &str = "com.autoscale.captura";
const GLOBAL_SHORTCUT: &str = "Alt+Space";
const SHORTCUTS_SETTING: &str = "keyboard_shortcuts";
const KEEP_OPEN_SETTING: &str = "keep_open";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct KeyboardShortcuts {
    capture: String,
    save: String,
    paste: String,
    search: String,
    close: String,
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
            save: "Command+Enter".to_string(),
            paste: "Command+Enter".to_string(),
            search: "Command+F".to_string(),
            close: "Command+W".to_string(),
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
            "save" => Some(&self.save),
            "paste" => Some(&self.paste),
            "search" => Some(&self.search),
            "close" => Some(&self.close),
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
            "save" => &mut self.save,
            "paste" => &mut self.paste,
            "search" => &mut self.search,
            "close" => &mut self.close,
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
    main_window_has_focused: AtomicBool,
    keep_open: AtomicBool,
}

impl AppState {
    fn new() -> Result<Self, String> {
        let database_path = database_path()?;
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
        Ok(Self {
            database,
            previous_application: Mutex::new(None),
            shortcuts: Mutex::new(shortcuts),
            shortcut_registered: AtomicBool::new(false),
            main_window_has_focused: AtomicBool::new(false),
            keep_open: AtomicBool::new(keep_open),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionStatus {
    accessibility_trusted: bool,
    post_event_trusted: bool,
    global_shortcut_registered: bool,
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
        .create_item(&content, kind, source_app.as_deref(), None)
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
    state
        .database
        .delete_item(&id)
        .map_err(|error| error.to_string())
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

        if !state.keep_open.load(Ordering::Relaxed) {
            hide_window(&app, "main");
        }
        macos::paste_text(&item.content, &target).map_err(|error| error.to_string())?;
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
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn permission_status(state: State<'_, AppState>) -> PermissionStatus {
    PermissionStatus {
        accessibility_trusted: macos::accessibility_trusted(),
        post_event_trusted: macos::post_event_trusted(),
        global_shortcut_registered: state.shortcut_registered.load(Ordering::Relaxed),
    }
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
        if action == "capture" && !state.shortcut_registered.load(Ordering::Relaxed) {
            app.global_shortcut()
                .register(shortcut.as_str())
                .map_err(|error| format!("That global shortcut is unavailable: {error}"))?;
            state.shortcut_registered.store(true, Ordering::Relaxed);
        }
        drop(shortcuts);
        return current_app_settings(&state);
    }

    if action == "capture" {
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
        if action == "capture" {
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
    let current_capture = shortcuts.capture.clone();

    if current_capture != defaults.capture {
        app.global_shortcut()
            .register(defaults.capture.as_str())
            .map_err(|error| format!("The default global shortcut is unavailable: {error}"))?;
        if let Err(error) = app.global_shortcut().unregister(current_capture.as_str()) {
            let _ = app.global_shortcut().unregister(defaults.capture.as_str());
            return Err(error.to_string());
        }
    }

    if let Err(error) = persist_shortcuts(&state, &defaults) {
        if current_capture != defaults.capture {
            let _ = app.global_shortcut().unregister(defaults.capture.as_str());
            let _ = app.global_shortcut().register(current_capture.as_str());
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

#[tauri::command]
fn request_accessibility() -> bool {
    macos::request_accessibility()
}

fn remember_frontmost_application(app: &AppHandle) {
    let Ok(active) = macos::frontmost_application() else {
        return;
    };
    if active.bundle_id.as_deref() == Some(APP_BUNDLE_ID) {
        return;
    }

    let state = app.state::<AppState>();
    if let Ok(mut previous) = state.previous_application.lock() {
        *previous = Some(active);
    };
}

fn handle_global_capture(app: AppHandle) {
    remember_frontmost_application(&app);
    let previous = app
        .state::<AppState>()
        .previous_application
        .lock()
        .ok()
        .and_then(|application| application.clone());

    match macos::copy_selection(previous.as_ref()) {
        Ok(Some(content)) => {
            let state = app.state::<AppState>();
            let result = state.database.create_item(
                &content,
                infer_kind(&content),
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
        Ok(None) => show_main_window(&app, true),
        Err(_) => {
            show_main_window(&app, true);
            let _ = app.emit("captura://permission-needed", ());
        }
    }
}

fn capture_clipboard(app: &AppHandle) {
    let Some(content) = macos::clipboard_text() else {
        show_main_window(app, true);
        return;
    };
    if content.trim().is_empty() {
        show_main_window(app, true);
        return;
    }

    remember_frontmost_application(app);
    let state = app.state::<AppState>();
    let previous = state
        .previous_application
        .lock()
        .ok()
        .and_then(|application| application.clone());
    if let Ok(item) = state.database.create_item(
        &content,
        infer_kind(&content),
        previous
            .as_ref()
            .map(|application| application.name.as_str()),
        previous
            .as_ref()
            .and_then(|application| application.bundle_id.as_deref()),
    ) {
        let _ = app.emit("captura://captured", &item);
        show_capture_hud(app, &item);
    }
}

fn show_main_window(app: &AppHandle, focus_composer: bool) {
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
    const SIZE: u32 = 18;
    let mut pixels = vec![0_u8; (SIZE * SIZE * 4) as usize];

    for y in 2..16 {
        for x in 2..16 {
            let on_outer = x == 2 || x == 3 || y == 2 || y == 3 || y == 14 || y == 15;
            let open_edge = x >= 13 && (6..=11).contains(&y);
            if on_outer && !open_edge {
                let offset = ((y * SIZE + x) * 4) as usize;
                pixels[offset] = 255;
                pixels[offset + 1] = 255;
                pixels[offset + 2] = 255;
                pixels[offset + 3] = 255;
            }
        }
    }

    Image::new_owned(pixels, SIZE, SIZE)
}

pub fn run() {
    let state = AppState::new().expect("failed to initialize Captura");

    tauri::Builder::default()
        .manage(state)
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let handle = app.clone();
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
                        show_main_window(tray.app_handle(), false);
                    }
                })
                .build(app)?;

            let shortcut = app
                .state::<AppState>()
                .shortcuts
                .lock()
                .map(|shortcuts| shortcuts.capture.clone())
                .unwrap_or_else(|_| GLOBAL_SHORTCUT.to_string());
            let registered = app.global_shortcut().register(shortcut.as_str()).is_ok();
            app.state::<AppState>()
                .shortcut_registered
                .store(registered, Ordering::Relaxed);

            // The paste target must be "the app the user was just working in",
            // not "the app that was frontmost when Captura opened" — with the
            // keep-open panel the user switches apps while Captura stays
            // visible, so the target has to follow them continuously.
            let tracker = app.handle().clone();
            thread::spawn(move || loop {
                remember_frontmost_application(&tracker);
                thread::sleep(Duration::from_millis(350));
            });

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
            list_sections,
            create_section,
            move_items_to_section,
            merge_items,
            paste_item,
            hide_main_window,
            quit_app,
            permission_status,
            get_app_settings,
            set_shortcut,
            reset_shortcuts,
            set_keep_open,
            capture_clipboard_now,
            request_accessibility,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Captura");
}
