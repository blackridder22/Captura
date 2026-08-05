use std::{ffi::c_void, ptr, ptr::NonNull, thread, time::Duration};

use block2::RcBlock;
use core_graphics::{
    event::{CGEvent, CGEventFlags, CGEventTapLocation, KeyCode},
    event_source::{CGEventSource, CGEventSourceStateID},
};
use objc2::{rc::Retained, MainThreadMarker};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationOptions, NSApplicationActivationPolicy,
    NSBitmapImageFileType, NSBitmapImageRep, NSColor, NSPasteboard, NSPasteboardType,
    NSPasteboardTypeHTML, NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardTypeTIFF,
    NSRunningApplication, NSScreenSaverWindowLevel, NSWindow, NSWindowCollectionBehavior,
    NSWorkspace, NSWorkspaceApplicationKey, NSWorkspaceDidActivateApplicationNotification,
};
use objc2_core_graphics::{CGPreflightPostEventAccess, CGRequestPostEventAccess};
use objc2_foundation::{
    NSArray, NSData, NSDictionary, NSNotification, NSNumber, NSOperationQueue, NSString, NSURL,
};
use tauri::WebviewWindow;
use thiserror::Error;
use uuid::Uuid;

type AXUIElementRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFStringRef = *const c_void;
type CFTypeRef = *const c_void;
type CFTypeId = usize;
type AXError = i32;

const AX_ERROR_SUCCESS: AXError = 0;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFGetTypeID(value: CFTypeRef) -> CFTypeId;
    fn CFRelease(value: CFTypeRef);
    fn CFStringGetTypeID() -> CFTypeId;
}

#[derive(Clone, Debug)]
pub struct ActiveApplication {
    pub pid: i32,
    pub name: String,
    pub bundle_id: Option<String>,
}

#[derive(Debug, Error)]
pub enum PlatformError {
    #[error("Accessibility permission is required")]
    AccessibilityPermission,
    #[error("could not create a macOS input event")]
    InputEvent,
    #[error("could not access the active application")]
    ActiveApplication,
    #[error("could not write to the clipboard")]
    ClipboardWrite,
    #[error("could not bring {0} forward to paste — click into it once and try again")]
    PasteTarget(String),
    #[error("could not open macOS Accessibility settings")]
    SystemSettings,
}

type PasteboardEntry = (Retained<NSPasteboardType>, Option<Retained<NSData>>);

pub struct ClipboardSnapshot {
    entries: Vec<PasteboardEntry>,
}

fn overlay_collection_behavior(
    mut behavior: NSWindowCollectionBehavior,
) -> NSWindowCollectionBehavior {
    behavior.remove(
        NSWindowCollectionBehavior::MoveToActiveSpace
            | NSWindowCollectionBehavior::Managed
            | NSWindowCollectionBehavior::ParticipatesInCycle
            | NSWindowCollectionBehavior::FullScreenPrimary
            | NSWindowCollectionBehavior::FullScreenNone
            | NSWindowCollectionBehavior::Primary
            | NSWindowCollectionBehavior::Auxiliary,
    );
    behavior.insert(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::CanJoinAllApplications
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::Transient
            | NSWindowCollectionBehavior::IgnoresCycle
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    behavior
}

pub fn configure_overlay_window(window: &WebviewWindow) -> tauri::Result<()> {
    // Tauri can make a window visible on normal Spaces, but fullscreen Spaces
    // also require AppKit's FullScreenAuxiliary collection behavior.
    let ns_window = unsafe { &*(window.ns_window()? as *mut NSWindow) };
    let behavior = overlay_collection_behavior(ns_window.collectionBehavior());

    ns_window.setCollectionBehavior(behavior);
    ns_window.setLevel(NSScreenSaverWindowLevel);
    ns_window.setHasShadow(false);
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    Ok(())
}

/// Reads back the invariants `configure_overlay_window` establishes, so the
/// smoke test can assert against the live NSWindow rather than our own config.
pub fn overlay_window_verified(window: &WebviewWindow) -> tauri::Result<bool> {
    let ns_window = unsafe { &*(window.ns_window()? as *mut NSWindow) };
    let behavior = ns_window.collectionBehavior();
    let required = NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::CanJoinAllApplications
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::Stationary;
    let forbidden =
        NSWindowCollectionBehavior::Managed | NSWindowCollectionBehavior::MoveToActiveSpace;
    Ok(behavior.contains(required)
        && !behavior.intersects(forbidden)
        && ns_window.level() == NSScreenSaverWindowLevel)
}

pub fn activation_policy_is_accessory(main_thread: MainThreadMarker) -> bool {
    NSApplication::sharedApplication(main_thread).activationPolicy()
        == NSApplicationActivationPolicy::Accessory
}

pub fn present_overlay_window(window: &WebviewWindow, focus: bool) -> tauri::Result<()> {
    let native_window = window.clone();
    window.run_on_main_thread(move || {
        let Ok(pointer) = native_window.ns_window() else {
            return;
        };
        let ns_window = unsafe { &*(pointer as *mut NSWindow) };
        ns_window.orderFrontRegardless();

        if focus {
            let Some(main_thread) = MainThreadMarker::new() else {
                return;
            };
            let application = NSApplication::sharedApplication(main_thread);
            application.activate();
            ns_window.makeKeyAndOrderFront(None);
        }
    })
}

impl ClipboardSnapshot {
    pub fn capture() -> Self {
        let pasteboard = NSPasteboard::generalPasteboard();
        let entries = pasteboard
            .types()
            .map(|types| {
                (0..types.len())
                    .map(|index| {
                        let data_type = types.objectAtIndex(index);
                        let data = pasteboard.dataForType(&data_type);
                        (data_type, data)
                    })
                    .collect()
            })
            .unwrap_or_default();

        Self { entries }
    }

    pub fn restore(&self) {
        let pasteboard = NSPasteboard::generalPasteboard();
        let _ = pasteboard.clearContents();

        if self.entries.is_empty() {
            return;
        }

        let data_types = self
            .entries
            .iter()
            .map(|(data_type, _)| data_type.clone())
            .collect::<Vec<_>>();
        let declared_types = NSArray::from_retained_slice(&data_types);
        unsafe {
            pasteboard.declareTypes_owner(&declared_types, None);
        }

        for (data_type, data) in &self.entries {
            let _ = pasteboard.setData_forType(data.as_deref(), data_type);
        }
    }
}

pub fn accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}

pub fn post_event_trusted() -> bool {
    CGPreflightPostEventAccess()
}

pub fn request_accessibility() -> bool {
    let key = NSString::from_str("AXTrustedCheckOptionPrompt");
    let value = NSNumber::new_bool(true);
    let options = NSDictionary::from_slices(&[&*key], &[&*value]);
    let accessibility = unsafe {
        AXIsProcessTrustedWithOptions(
            (&*options as *const NSDictionary<NSString, NSNumber>).cast::<c_void>(),
        ) != 0
    };
    let post_events = CGRequestPostEventAccess();
    accessibility && post_events
}

pub fn open_accessibility_settings() -> Result<(), PlatformError> {
    let destination = NSString::from_str(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
    let url = NSURL::URLWithString(&destination).ok_or(PlatformError::SystemSettings)?;
    if NSWorkspace::sharedWorkspace().openURL(&url) {
        Ok(())
    } else {
        // Fall back to the system prompt if the deep link is unavailable on
        // this macOS version. The return value reports current trust, not
        // whether the prompt was displayed, so it is intentionally ignored.
        let _ = request_accessibility();
        Ok(())
    }
}

fn active_application_from(application: &NSRunningApplication) -> ActiveApplication {
    ActiveApplication {
        pid: application.processIdentifier(),
        name: application
            .localizedName()
            .map(|name| name.to_string())
            .unwrap_or_else(|| "Previous app".to_string()),
        bundle_id: application
            .bundleIdentifier()
            .map(|identifier| identifier.to_string()),
    }
}

pub fn frontmost_application() -> Result<ActiveApplication, PlatformError> {
    let workspace = NSWorkspace::sharedWorkspace();
    let application = workspace
        .frontmostApplication()
        .ok_or(PlatformError::ActiveApplication)?;

    Ok(active_application_from(&application))
}

/// Registers an app-lifetime observer for application activation. Must run on
/// the main thread; the block executes on the main queue.
pub fn observe_frontmost_application(
    _main_thread: MainThreadMarker,
    callback: impl Fn(ActiveApplication) + 'static,
) {
    let block = RcBlock::new(move |notification: NonNull<NSNotification>| {
        let Some(user_info) = (unsafe { notification.as_ref().userInfo() }) else {
            return;
        };
        let Some(entry) = user_info.objectForKey(unsafe { NSWorkspaceApplicationKey }) else {
            return;
        };
        let Ok(application) = entry.downcast::<NSRunningApplication>() else {
            return;
        };
        callback(active_application_from(&application));
    });

    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    let token = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidActivateApplicationNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    // The observer lives for the whole app; parking the non-Send token in a
    // static buys nothing, so leak it intentionally.
    std::mem::forget(token);
}

pub fn activate_application(application: &ActiveApplication) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(application.pid)
        .map(|running| {
            running.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows)
        })
        .unwrap_or(false)
}

pub fn pasteboard_change_count() -> isize {
    NSPasteboard::generalPasteboard().changeCount()
}

pub fn clipboard_text() -> Option<String> {
    let pasteboard = NSPasteboard::generalPasteboard();
    let string_type = unsafe { NSPasteboardTypeString };
    pasteboard
        .stringForType(string_type)
        .map(|value| value.to_string())
}

fn clipboard_html() -> Option<String> {
    NSPasteboard::generalPasteboard()
        .stringForType(unsafe { NSPasteboardTypeHTML })
        .map(|value| value.to_string())
}

fn markdown_from_html(html: &str) -> Option<String> {
    let markdown = html2markdown::convert(html);
    let markdown = markdown.trim();
    (!markdown.is_empty()).then(|| markdown.to_string())
}

fn captured_pasteboard_selection() -> Option<CapturedSelection> {
    // A copied image may also advertise plain text or HTML (for example, its
    // source URL). Prefer the actual pixels whenever an image flavor exists.
    if let Some(png) = clipboard_image_png() {
        return Some(CapturedSelection::Image(png));
    }

    if let Some(markdown) = clipboard_html().and_then(|html| markdown_from_html(&html)) {
        return Some(CapturedSelection::Text(markdown));
    }

    clipboard_text().and_then(|text| {
        let text = text.trim();
        (!text.is_empty()).then(|| CapturedSelection::Text(text.to_string()))
    })
}

/// Reads a clipboard image as PNG bytes, converting TIFF (the common
/// pasteboard flavor for screenshots and app copies) when necessary.
pub fn clipboard_image_png() -> Option<Vec<u8>> {
    let pasteboard = NSPasteboard::generalPasteboard();
    if let Some(data) = pasteboard.dataForType(unsafe { NSPasteboardTypePNG }) {
        return Some(data.to_vec());
    }
    let tiff = pasteboard.dataForType(unsafe { NSPasteboardTypeTIFF })?;
    normalize_image_to_png(&tiff.to_vec())
}

/// Re-encodes any image format AppKit can decode into PNG so storage,
/// thumbnails, and paste-back all share one format.
pub fn normalize_image_to_png(data: &[u8]) -> Option<Vec<u8>> {
    let ns_data = NSData::with_bytes(data);
    let rep = NSBitmapImageRep::imageRepWithData(&ns_data)?;
    let properties = NSDictionary::new();
    let png =
        unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties) }?;
    Some(png.to_vec())
}

pub fn write_clipboard_image(png: &[u8]) -> Result<(), PlatformError> {
    let pasteboard = NSPasteboard::generalPasteboard();
    let _ = pasteboard.clearContents();

    let png_type = unsafe { NSPasteboardTypePNG };
    let tiff_type = unsafe { NSPasteboardTypeTIFF };
    let declared = NSArray::from_slice(&[png_type, tiff_type]);
    unsafe {
        pasteboard.declareTypes_owner(&declared, None);
    }

    let ns_png = NSData::with_bytes(png);
    let mut ok = pasteboard.setData_forType(Some(&ns_png), png_type);
    // A TIFF flavor keeps paste working in apps that don't accept PNG.
    if let Some(rep) = NSBitmapImageRep::imageRepWithData(&ns_png) {
        if let Some(tiff) = rep.TIFFRepresentation() {
            ok |= pasteboard.setData_forType(Some(&tiff), tiff_type);
        }
    }
    if ok {
        Ok(())
    } else {
        Err(PlatformError::ClipboardWrite)
    }
}

pub fn write_clipboard_text(value: &str) -> Result<(), PlatformError> {
    let pasteboard = NSPasteboard::generalPasteboard();
    let _ = pasteboard.clearContents();
    let string = NSString::from_str(value);
    let string_type = unsafe { NSPasteboardTypeString };
    if pasteboard.setString_forType(&string, string_type) {
        Ok(())
    } else {
        Err(PlatformError::ClipboardWrite)
    }
}

fn copy_accessibility_attribute(
    element: AXUIElementRef,
    attribute: &NSString,
) -> Option<CFTypeRef> {
    let mut value = ptr::null();
    let result = unsafe {
        AXUIElementCopyAttributeValue(
            element,
            (attribute as *const NSString).cast::<c_void>(),
            &mut value,
        )
    };
    (result == AX_ERROR_SUCCESS && !value.is_null()).then_some(value)
}

fn selected_text_from_root(root_element: AXUIElementRef) -> Option<String> {
    let focused_attribute = NSString::from_str("AXFocusedUIElement");
    let selected_text_attribute = NSString::from_str("AXSelectedText");
    let focused_element =
        copy_accessibility_attribute(root_element, &focused_attribute).unwrap_or(root_element);
    let selected_value = copy_accessibility_attribute(focused_element, &selected_text_attribute);

    if focused_element != root_element {
        unsafe { CFRelease(focused_element) };
    }

    let selected_value = selected_value?;
    let is_string = unsafe { CFGetTypeID(selected_value) == CFStringGetTypeID() };
    let selected = is_string.then(|| {
        let value = unsafe { &*(selected_value as *const NSString) };
        value.to_string()
    });
    unsafe { CFRelease(selected_value) };

    selected.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn selected_text_via_accessibility(application: &ActiveApplication) -> Option<String> {
    if !accessibility_trusted() {
        return None;
    }

    let system_element = unsafe { AXUIElementCreateSystemWide() };
    if !system_element.is_null() {
        let selection = selected_text_from_root(system_element);
        unsafe { CFRelease(system_element) };
        if selection.is_some() {
            return selection;
        }
    }

    let app_element = unsafe { AXUIElementCreateApplication(application.pid) };
    if app_element.is_null() {
        return None;
    }
    let selection = selected_text_from_root(app_element);
    unsafe { CFRelease(app_element) };
    selection
}

pub enum CapturedSelection {
    Text(String),
    Image(Vec<u8>),
}

pub fn copy_selection(
    application: Option<&ActiveApplication>,
) -> Result<Option<CapturedSelection>, PlatformError> {
    // Keep Accessibility text only as a fallback. Rich sources such as
    // browsers and Electron apps expose structure (headings, lists, links,
    // code) through the pasteboard, while AXSelectedText is necessarily flat.
    let accessibility_fallback = application.and_then(selected_text_via_accessibility);

    if !post_event_trusted() {
        return Err(PlatformError::AccessibilityPermission);
    }

    let snapshot = ClipboardSnapshot::capture();
    let sentinel = format!("captura-selection-{}", Uuid::new_v4());
    let captured = (|| {
        write_clipboard_text(&sentinel)?;
        let sentinel_change = pasteboard_change_count();
        post_command_key(KeyCode::ANSI_C)?;

        for _ in 0..12 {
            thread::sleep(Duration::from_millis(25));
            if pasteboard_change_count() != sentinel_change {
                // The source app replaced our sentinel. Read every supported
                // flavor before restoring the user's original clipboard.
                return Ok(captured_pasteboard_selection());
            }
        }

        Ok(accessibility_fallback.map(CapturedSelection::Text))
    })();
    snapshot.restore();
    captured
}

pub fn paste_text(value: &str, target: &ActiveApplication) -> Result<(), PlatformError> {
    if !post_event_trusted() {
        return Err(PlatformError::AccessibilityPermission);
    }

    let snapshot = ClipboardSnapshot::capture();
    write_clipboard_text(value)?;
    deliver_paste(target, &snapshot)
}

pub fn paste_image(png: &[u8], target: &ActiveApplication) -> Result<(), PlatformError> {
    if !post_event_trusted() {
        return Err(PlatformError::AccessibilityPermission);
    }

    let snapshot = ClipboardSnapshot::capture();
    write_clipboard_image(png)?;
    deliver_paste(target, &snapshot)
}

fn deliver_paste(
    target: &ActiveApplication,
    snapshot: &ClipboardSnapshot,
) -> Result<(), PlatformError> {
    // A fixed delay is not enough: coming out of an overlay panel (or into a
    // fullscreen Space) activation can take several hundred milliseconds, and
    // a ⌘V posted before the switch lands in the wrong app or nowhere.
    let mut frontmost = false;
    for attempt in 0..24 {
        if attempt % 8 == 0 {
            let _ = activate_application(target);
        }
        thread::sleep(Duration::from_millis(50));
        if frontmost_application()
            .map(|application| application.pid == target.pid)
            .unwrap_or(false)
        {
            frontmost = true;
            break;
        }
    }
    if !frontmost {
        snapshot.restore();
        return Err(PlatformError::PasteTarget(target.name.clone()));
    }

    thread::sleep(Duration::from_millis(90));
    post_command_key(KeyCode::ANSI_V)?;
    thread::sleep(Duration::from_millis(320));
    snapshot.restore();
    Ok(())
}

fn post_command_key(keycode: u16) -> Result<(), PlatformError> {
    // A global shortcut may still have Option/Shift physically held when this
    // runs. A private state table prevents those hardware modifiers from
    // leaking into the synthetic Command+C / Command+V event.
    let source =
        CGEventSource::new(CGEventSourceStateID::Private).map_err(|_| PlatformError::InputEvent)?;
    let key_down = CGEvent::new_keyboard_event(source.clone(), keycode, true)
        .map_err(|_| PlatformError::InputEvent)?;
    let key_up = CGEvent::new_keyboard_event(source, keycode, false)
        .map_err(|_| PlatformError::InputEvent)?;

    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);
    thread::sleep(Duration::from_millis(12));
    key_up.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static APP_KIT_TEST_LOCK: Mutex<()> = Mutex::new(());

    const ONE_PIXEL_PNG: [u8; 70] = [
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 252, 207, 192, 80,
        15, 0, 4, 133, 1, 128, 132, 169, 140, 33, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];

    #[test]
    fn normalize_image_round_trips_png() {
        let _guard = APP_KIT_TEST_LOCK.lock().expect("AppKit test lock");
        let png = normalize_image_to_png(&ONE_PIXEL_PNG).expect("decode png");
        assert_eq!(&png[..8], &ONE_PIXEL_PNG[..8], "PNG magic preserved");
        assert!(normalize_image_to_png(b"not an image").is_none());
    }

    #[test]
    fn clipboard_image_write_and_read_round_trip() {
        let _guard = APP_KIT_TEST_LOCK.lock().expect("AppKit test lock");
        // Guard the user's clipboard: snapshot before, restore after.
        let snapshot = ClipboardSnapshot::capture();
        let result = write_clipboard_image(&ONE_PIXEL_PNG).map(|()| clipboard_image_png());
        snapshot.restore();

        let read_back = result.expect("write image").expect("read image back");
        assert_eq!(&read_back[..8], &ONE_PIXEL_PNG[..8], "PNG magic preserved");
    }

    #[test]
    fn clipboard_text_write_preserves_markdown_exactly() {
        let _guard = APP_KIT_TEST_LOCK.lock().expect("AppKit test lock");
        let snapshot = ClipboardSnapshot::capture();
        let markdown = "# Heading\n\n- nested\n  - child\n\n```ts\nconst x = 1;\n```";
        let result = write_clipboard_text(markdown).map(|()| clipboard_text());
        snapshot.restore();

        assert_eq!(result.expect("write text").as_deref(), Some(markdown));
    }

    #[test]
    fn rich_html_selection_becomes_structured_markdown() {
        let html = r#"
            <h1>Captura v0.0.3 — Markdown Round-Trip</h1>
            <h2>Summary</h2>
            <p>This pass makes <strong>three</strong> workflows:</p>
            <ol>
              <li>Text captures preserve <a href="https://example.com/docs">links</a>.</li>
              <li>Nested structure:
                <ul><li>one</li><li>two</li></ul>
              </li>
            </ol>
            <pre><code class="language-rust">let captured = true;
println!("{captured}");</code></pre>
        "#;

        let markdown = markdown_from_html(html).expect("converted markdown");
        assert_eq!(
            markdown,
            "# Captura v0.0.3 — Markdown Round-Trip\n\n## Summary\n\nThis pass makes **three** workflows:\n\n1. Text captures preserve [links](https://example.com/docs).\n2. Nested structure:\n   * one\n   * two\n\n```rust\nlet captured = true;\nprintln!(\"{captured}\");\n```"
        );
    }

    #[test]
    fn appkit_pasteboard_prefers_rich_markdown_over_flat_text() {
        let _guard = APP_KIT_TEST_LOCK.lock().expect("AppKit test lock");
        let snapshot = ClipboardSnapshot::capture();
        let captured = {
            let pasteboard = NSPasteboard::generalPasteboard();
            let _ = pasteboard.clearContents();
            let html_type = unsafe { NSPasteboardTypeHTML };
            let text_type = unsafe { NSPasteboardTypeString };
            let types = NSArray::from_slice(&[html_type, text_type]);
            unsafe { pasteboard.declareTypes_owner(&types, None) };

            let html = NSString::from_str(
                "<h1>Heading</h1><p>A <a href=\"https://example.com\">link</a>.</p><ul><li>One</li><li>Two</li></ul>",
            );
            let flat = NSString::from_str("Heading\nA link.\nOne\nTwo");
            assert!(pasteboard.setString_forType(&html, html_type));
            assert!(pasteboard.setString_forType(&flat, text_type));
            captured_pasteboard_selection()
        };
        snapshot.restore();

        match captured {
            Some(CapturedSelection::Text(markdown)) => assert_eq!(
                markdown,
                "# Heading\n\nA [link](https://example.com).\n\n* One\n* Two"
            ),
            _ => panic!("expected structured Markdown text"),
        }
    }

    #[test]
    fn active_application_from_never_produces_an_empty_name() {
        let _guard = APP_KIT_TEST_LOCK.lock().expect("AppKit test lock");
        // In a bare test harness currentApplication() is a placeholder with
        // no localized name, which exercises the "Previous app" fallback.
        let current = NSRunningApplication::currentApplication();
        let active = active_application_from(&current);
        assert!(!active.name.is_empty());
    }

    #[test]
    fn overlay_behavior_joins_normal_and_fullscreen_spaces() {
        let behavior = overlay_collection_behavior(
            NSWindowCollectionBehavior::MoveToActiveSpace
                | NSWindowCollectionBehavior::Managed
                | NSWindowCollectionBehavior::FullScreenPrimary,
        );

        assert!(behavior.contains(NSWindowCollectionBehavior::CanJoinAllSpaces));
        assert!(behavior.contains(NSWindowCollectionBehavior::CanJoinAllApplications));
        assert!(behavior.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
        assert!(behavior.contains(NSWindowCollectionBehavior::Stationary));
        assert!(behavior.contains(NSWindowCollectionBehavior::Transient));
        assert!(behavior.contains(NSWindowCollectionBehavior::IgnoresCycle));
        assert!(!behavior.contains(NSWindowCollectionBehavior::MoveToActiveSpace));
        assert!(!behavior.contains(NSWindowCollectionBehavior::Managed));
        assert!(!behavior.contains(NSWindowCollectionBehavior::FullScreenPrimary));
        assert!(!behavior.contains(NSWindowCollectionBehavior::FullScreenNone));
        assert!(!behavior.contains(NSWindowCollectionBehavior::Primary));
        assert!(!behavior.contains(NSWindowCollectionBehavior::Auxiliary));
    }
}
