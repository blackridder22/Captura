//! The reader is an auxiliary window, never another copy of the queue.
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder,
};

use crate::{database::CaptureItem, AppState};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DetailMode {
    Preview,
    Edit,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DetailRequest {
    pub ids: Vec<String>,
    pub mode: DetailMode,
}

#[tauri::command]
pub async fn open_capture_detail(
    app: AppHandle,
    ids: Vec<String>,
    mode: DetailMode,
) -> Result<(), String> {
    if ids.is_empty() {
        return Err("Select a capture to preview.".into());
    }
    if matches!(mode, DetailMode::Edit) && ids.len() != 1 {
        return Err("Edit one capture at a time.".into());
    }
    let request = DetailRequest { ids, mode };
    *app.state::<AppState>()
        .detail_request
        .lock()
        .map_err(|_| "Reader state unavailable")? = Some(request.clone());
    let window = if let Some(window) = app.get_webview_window("capture-detail") {
        window
    } else {
        let window = WebviewWindowBuilder::new(
            &app,
            "capture-detail",
            WebviewUrl::App("index.html?detail=1".into()),
        )
        .title("Captura — Capture")
        .inner_size(760.0, 600.0)
        .min_inner_size(560.0, 420.0)
        .resizable(true)
        .disable_drag_drop_handler()
        .visible(false)
        .skip_taskbar(true)
        .build()
        .map_err(|error| error.to_string())?;
        if let Some(monitor) = app
            .get_webview_window("main")
            .and_then(|main| main.current_monitor().ok().flatten())
        {
            let area = monitor.work_area();
            let size = window.outer_size().map_err(|error| error.to_string())?;
            let x = area.position.x + (area.size.width.saturating_sub(size.width) / 2) as i32;
            let y = area.position.y + (area.size.height.saturating_sub(size.height) / 2) as i32;
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|error| error.to_string())?;
        } else {
            let _ = window.center();
        }
        window
    };
    if let (Ok(Some(monitor)), Ok(position), Ok(size)) = (
        window.current_monitor(),
        window.outer_position(),
        window.outer_size(),
    ) {
        let area = monitor.work_area();
        let x = position.x.clamp(
            area.position.x,
            area.position.x + area.size.width.saturating_sub(size.width) as i32,
        );
        let y = position.y.clamp(
            area.position.y,
            area.position.y + area.size.height.saturating_sub(size.height) as i32,
        );
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    window
        .emit("captura://detail-request", request)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_detail_request(state: State<'_, AppState>) -> Result<Option<DetailRequest>, String> {
    state
        .detail_request
        .lock()
        .map(|request| request.clone())
        .map_err(|_| "Reader state unavailable".into())
}

#[tauri::command]
pub async fn get_capture_details(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<Vec<CaptureItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        ids.iter()
            .filter_map(|id| match state.database.get_item(id) {
                Ok(item) => Some(Ok(item)),
                Err(crate::database::DatabaseError::NotFound) => None,
                Err(error) => Some(Err(error.to_string())),
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn close_capture_detail(app: AppHandle) -> Result<(), String> {
    *app.state::<AppState>()
        .detail_request
        .lock()
        .map_err(|_| "Reader state unavailable")? = None;
    if let Some(window) = app.get_webview_window("capture-detail") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}
