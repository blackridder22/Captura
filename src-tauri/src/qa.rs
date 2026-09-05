//! Opt-in local packaged-app inspection. No socket, command registration, or
//! polling exists in a normal run. Requires an explicitly isolated test store.
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::mpsc, thread, time::Duration};
use tauri::{AppHandle, Manager};

pub fn start(app: AppHandle) {
    if std::env::var("CAPTURA_TEST_MODE").as_deref() != Ok("1") {
        return;
    }
    let Ok(directory) = std::env::var("CAPTURA_QA_DIR") else {
        return;
    };
    let directory = PathBuf::from(directory);
    if !directory.is_absolute() {
        return;
    }
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    thread::spawn(move || loop {
        let request_path = directory.join("request.json");
        if let Ok(text) = fs::read_to_string(&request_path) {
            let _ = fs::remove_file(&request_path);
            let request: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let result = execute(&app, &request, &directory);
            let response = match result {
                Ok(value) => json!({"id": request["id"], "ok":true, "value":value}),
                Err(error) => json!({"id": request["id"], "ok":false, "error":error}),
            };
            if fs::write(directory.join("response.tmp"), response.to_string()).is_ok() {
                let _ = fs::rename(
                    directory.join("response.tmp"),
                    directory.join("response.json"),
                );
            }
        }
        thread::sleep(Duration::from_millis(25));
    });
}

fn execute(app: &AppHandle, request: &Value, directory: &std::path::Path) -> Result<Value, String> {
    let label = request["window"].as_str().unwrap_or("main");
    match request["action"].as_str().unwrap_or("") {
        "eval" => {
            let window = app.get_webview_window(label).ok_or("Window missing")?;
            let script = request["script"].as_str().ok_or("Script missing")?;
            let (send, receive) = mpsc::channel();
            window
                .eval_with_callback(script, move |value| {
                    let _ = send.send(value);
                })
                .map_err(|e| e.to_string())?;
            let value = receive
                .recv_timeout(Duration::from_secs(15))
                .map_err(|e| e.to_string())?;
            Ok(serde_json::from_str(&value).unwrap_or(Value::String(value)))
        }
        "show" => {
            crate::present_main_window(app, false);
            Ok(json!(true))
        }
        "detail" => {
            let ids = serde_json::from_value(request["ids"].clone()).map_err(|e| e.to_string())?;
            let mode =
                serde_json::from_value(request["mode"].clone()).map_err(|e| e.to_string())?;
            tauri::async_runtime::block_on(crate::detail::open_capture_detail(
                app.clone(),
                ids,
                mode,
            ))?;
            Ok(json!(true))
        }
        "geometry" => {
            let window = app.get_webview_window(label).ok_or("Window missing")?;
            Ok(
                json!({"position":window.inner_position().map_err(|e| e.to_string())?, "size":window.inner_size().map_err(|e| e.to_string())?, "scale":window.scale_factor().map_err(|e| e.to_string())?}),
            )
        }
        "snapshot" => {
            let window = app.get_webview_window(label).ok_or("Window missing")?;
            let filename = request["filename"].as_str().unwrap_or("snapshot.png");
            if filename.contains('/') || filename.contains("..") {
                return Err("Invalid snapshot name".into());
            }
            let path = directory.join(filename);
            let written = path.clone();
            let (send, receive) = mpsc::channel();
            window.with_webview(move |view| {
                use objc2::{msg_send, runtime::AnyObject};
                use objc2_app_kit::NSImage;
                use objc2_foundation::NSError;
                let completion = block2::RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
                    let result = (|| {
                        let image = unsafe { image.as_ref() }.ok_or("Snapshot failed")?;
                        let data = image.TIFFRepresentation().ok_or("Snapshot has no pixels")?;
                        let png = crate::platform::macos::normalize_image_to_png(unsafe { data.as_bytes_unchecked() }).ok_or("PNG conversion failed")?;
                        fs::write(&path, png).map_err(|e| e.to_string())?;
                        Ok::<(), String>(())
                    })();
                    let _ = send.send(result);
                });
                unsafe {
                    let native = &*(view.inner() as *mut AnyObject);
                    let _: () = msg_send![native, takeSnapshotWithConfiguration: std::ptr::null::<AnyObject>(), completionHandler: &*completion];
                }
            }).map_err(|e| e.to_string())?;
            receive
                .recv_timeout(Duration::from_secs(15))
                .map_err(|e| e.to_string())??;
            Ok(json!(written))
        }
        "quit" => {
            app.exit(0);
            Ok(json!(true))
        }
        _ => Err("Unknown QA action".into()),
    }
}
