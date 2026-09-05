//! Opt-in local packaged-app inspection. No socket, command registration, or
//! polling exists in a normal run. Requires an explicitly isolated test store.
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::mpsc, thread, time::Duration};
use tauri::{AppHandle, Manager};

thread_local! {
    static CLIPBOARD_BACKUP: std::cell::RefCell<Option<crate::platform::macos::ClipboardSnapshot>> = const { std::cell::RefCell::new(None) };
}

fn on_main(
    app: &AppHandle,
    action: impl FnOnce() -> Result<Value, String> + Send + 'static,
) -> Result<Value, String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(action());
    })
    .map_err(|e| e.to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(15))
        .map_err(|e| e.to_string())?
}

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
        "resize" => {
            let window = app.get_webview_window(label).ok_or("Window missing")?;
            let width = request["width"].as_f64().ok_or("Width missing")?;
            let height = request["height"].as_f64().ok_or("Height missing")?;
            window
                .set_size(tauri::LogicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "windows" | "picker-cancel" => {
            let cancel = request["action"] == "picker-cancel";
            on_main(app, move || {
                use objc2::{ClassType, MainThreadMarker};
                use objc2_app_kit::{NSApplication, NSOpenPanel};
                use objc2_foundation::NSObjectProtocol;
                let mtm = MainThreadMarker::new().ok_or("Not on main thread")?;
                let windows = NSApplication::sharedApplication(mtm).windows();
                let mut result = Vec::new();
                for window in windows.iter() {
                    let picker = window.isKindOfClass(NSOpenPanel::class());
                    let frame = window.frame();
                    result.push(json!({"title":window.title().to_string(),"visible":window.isVisible(),"key":window.isKeyWindow(),"level":window.level(),"picker":picker,"frame":{"x":frame.origin.x,"y":frame.origin.y,"width":frame.size.width,"height":frame.size.height}}));
                    if picker && cancel && window.isVisible() {
                        unsafe {
                            let _: () = objc2::msg_send![&*window, cancel: std::ptr::null::<objc2::runtime::AnyObject>()];
                        }
                    }
                }
                Ok(json!(result))
            })
        }
        "clipboard" => {
            let action = request["operation"]
                .as_str()
                .unwrap_or("inspect")
                .to_string();
            let paths: Vec<String> =
                serde_json::from_value(request["paths"].clone()).unwrap_or_default();
            on_main(app, move || {
                use objc2::runtime::ProtocolObject;
                use objc2_app_kit::{
                    NSPasteboard, NSPasteboardItem, NSPasteboardTypeFileURL, NSPasteboardWriting,
                };
                use objc2_foundation::{NSArray, NSString, NSURL};
                let board = NSPasteboard::generalPasteboard();
                match action.as_str() {
                    "backup" => CLIPBOARD_BACKUP.with(|backup| {
                        if backup.borrow().is_none() {
                            *backup.borrow_mut() =
                                Some(crate::platform::macos::ClipboardSnapshot::capture());
                        }
                    }),
                    "restore" => CLIPBOARD_BACKUP.with(|backup| {
                        if let Some(snapshot) = backup.borrow_mut().take() {
                            snapshot.restore();
                        }
                    }),
                    "files" => {
                        board.clearContents();
                        let items: Vec<_> = paths
                            .iter()
                            .map(|path| {
                                let item = NSPasteboardItem::new();
                                let url = NSURL::fileURLWithPath(&NSString::from_str(path));
                                let encoded = url.absoluteString().ok_or("File URL missing")?;
                                if !item
                                    .setString_forType(&encoded, unsafe { NSPasteboardTypeFileURL })
                                {
                                    return Err("Pasteboard write failed");
                                }
                                Ok(item)
                            })
                            .collect::<Result<_, &str>>()?;
                        let writers: Vec<&ProtocolObject<dyn NSPasteboardWriting>> = items
                            .iter()
                            .map(|item| ProtocolObject::from_ref(&**item))
                            .collect();
                        if !board.writeObjects(&NSArray::from_slice(&writers)) {
                            return Err("Pasteboard write failed".into());
                        }
                    }
                    _ => {}
                }
                Ok(
                    json!({"changeCount":board.changeCount(),"types":board.types().map(|types|types.iter().map(|kind|kind.to_string()).collect::<Vec<_>>())}),
                )
            })
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
