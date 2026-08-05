//! Packaged-app smoke mode, gated on `CAPTURA_SMOKE=1`.
//!
//! Verifies the invariants Chromium-based QA cannot see (real WKWebView
//! windows, NSWindow collection behavior, activation policy) against the
//! fully initialized production startup path, writes a JSON report, and
//! exits. Without the environment variable the app's behavior is untouched.

use std::{env, fs, path::PathBuf, sync::mpsc, thread, time::Duration};

use objc2::MainThreadMarker;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{database_path, platform::macos, AppState};

#[derive(Serialize)]
struct SmokeCheck {
    name: &'static str,
    required: bool,
    pass: bool,
    detail: String,
}

#[derive(Serialize)]
struct SmokeReport {
    version: u32,
    timestamp: String,
    pass: bool,
    checks: Vec<SmokeCheck>,
}

pub fn start_if_requested(app: AppHandle) {
    if env::var("CAPTURA_SMOKE").as_deref() != Ok("1") {
        return;
    }
    thread::spawn(move || {
        let code = run(&app);
        // AppHandle::exit does not reliably propagate the process exit code;
        // the report is already flushed, so exit directly.
        use std::io::Write;
        let _ = std::io::stdout().flush();
        std::process::exit(code);
    });
}

fn run(app: &AppHandle) -> i32 {
    wait_for_windows(app);

    // Activation policy and overlay flags are applied when Tauri enters its
    // run loop, which races this thread — retry until stable or deadline.
    let mut checks = collect_checks(app);
    for _ in 0..40 {
        if required_pass(&checks) {
            break;
        }
        thread::sleep(Duration::from_millis(200));
        checks = collect_checks(app);
    }
    let pass = required_pass(&checks);
    let report = SmokeReport {
        version: 1,
        timestamp: chrono::Utc::now().to_rfc3339(),
        pass,
        checks,
    };

    match write_report(&report) {
        Ok(path) => {
            println!("captura smoke report: {}", path.display());
            if pass {
                0
            } else {
                1
            }
        }
        Err(error) => {
            eprintln!("captura smoke: could not write report: {error}");
            2
        }
    }
}

fn required_pass(checks: &[SmokeCheck]) -> bool {
    checks.iter().all(|check| !check.required || check.pass)
}

fn wait_for_windows(app: &AppHandle) {
    for _ in 0..100 {
        if app.get_webview_window("main").is_some()
            && app.get_webview_window("capture-hud").is_some()
        {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn collect_checks(app: &AppHandle) -> Vec<SmokeCheck> {
    let state = app.state::<AppState>();
    let mut checks = Vec::new();

    checks.push(check("db_open", true, database_open_detail()));
    checks.push(check(
        "db_integrity",
        true,
        state
            .database
            .integrity_check()
            .map_err(|error| error.to_string())
            .and_then(|ok| ok.then_some(()).ok_or_else(|| "corrupt".to_string())),
    ));

    for (name, label) in [
        ("window_main_exists", "main"),
        ("window_hud_exists", "capture-hud"),
    ] {
        checks.push(check(
            name,
            true,
            app.get_webview_window(label)
                .map(|_| ())
                .ok_or_else(|| "window missing".to_string()),
        ));
    }

    for (name, label) in [
        ("overlay_main_configured", "main"),
        ("overlay_hud_configured", "capture-hud"),
    ] {
        let result = match app.get_webview_window(label) {
            Some(window) => on_main_thread(app, move || {
                macos::overlay_window_verified(&window).map_err(|error| error.to_string())
            })
            .and_then(|verified| verified)
            .and_then(|ok| ok.then_some(()).ok_or_else(|| "flags wrong".to_string())),
            None => Err("window missing".to_string()),
        };
        checks.push(check(name, true, result));
    }

    checks.push(check(
        "activation_policy_accessory",
        true,
        on_main_thread(app, || {
            // Inside run_on_main_thread the marker is guaranteed available.
            MainThreadMarker::new()
                .map(macos::activation_policy_is_accessory)
                .unwrap_or(false)
        })
        .and_then(|ok| ok.then_some(()).ok_or_else(|| "not accessory".to_string())),
    ));

    checks.push(check(
        "global_shortcut_registered",
        true,
        state
            .shortcut_registered
            .load(std::sync::atomic::Ordering::Relaxed)
            .then_some(())
            .ok_or_else(|| "not registered".to_string()),
    ));

    // Reported-only: permission grants cannot exist on unattended machines.
    checks.push(report_only(
        "accessibility_trusted",
        macos::accessibility_trusted(),
    ));
    checks.push(report_only(
        "post_event_trusted",
        macos::post_event_trusted(),
    ));
    checks.push(report_only(
        "frontmost_query_ok",
        macos::frontmost_application().is_ok(),
    ));
    checks.push(report_only(
        "previous_application_present",
        state
            .previous_application
            .lock()
            .map(|previous| previous.is_some())
            .unwrap_or(false),
    ));

    checks
}

fn database_open_detail() -> Result<(), String> {
    let path = database_path()?;
    if path.exists() {
        Ok(())
    } else {
        Err(format!("missing {}", path.display()))
    }
}

fn check(name: &'static str, required: bool, result: Result<(), String>) -> SmokeCheck {
    match result {
        Ok(()) => SmokeCheck {
            name,
            required,
            pass: true,
            detail: "ok".to_string(),
        },
        Err(detail) => SmokeCheck {
            name,
            required,
            pass: false,
            detail,
        },
    }
}

fn report_only(name: &'static str, pass: bool) -> SmokeCheck {
    SmokeCheck {
        name,
        required: false,
        pass,
        detail: if pass { "ok" } else { "unavailable" }.to_string(),
    }
}

fn on_main_thread<T: Send + 'static>(
    app: &AppHandle,
    task: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(task());
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "main thread dispatch timeout".to_string())
}

fn write_report(report: &SmokeReport) -> Result<PathBuf, String> {
    let path = env::var("CAPTURA_SMOKE_REPORT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::temp_dir().join("captura-smoke.json"));
    let serialized = serde_json::to_string_pretty(report).map_err(|error| error.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serialized).map_err(|error| error.to_string())?;
    fs::rename(&temp, &path).map_err(|error| error.to_string())?;
    Ok(path)
}
