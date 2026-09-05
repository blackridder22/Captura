//! Load full capture content for preview and editing inside the menubar panel.
use tauri::{AppHandle, Manager};

use crate::{database::CaptureItem, AppState};

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
