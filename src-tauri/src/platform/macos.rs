use std::{ffi::c_void, ptr, thread, time::Duration};

use core_graphics::{
    event::{CGEvent, CGEventFlags, CGEventTapLocation, KeyCode},
    event_source::{CGEventSource, CGEventSourceStateID},
};
use objc2::{rc::Retained, MainThreadMarker};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationOptions, NSColor, NSPasteboard, NSPasteboardType,
    NSPasteboardTypeString, NSRunningApplication, NSScreenSaverWindowLevel, NSWindow,
    NSWindowCollectionBehavior, NSWorkspace,
};
use objc2_core_graphics::{CGPreflightPostEventAccess, CGRequestPostEventAccess};
use objc2_foundation::{NSArray, NSData, NSDictionary, NSNumber, NSString};
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

pub fn frontmost_application() -> Result<ActiveApplication, PlatformError> {
    let workspace = NSWorkspace::sharedWorkspace();
    let application = workspace
        .frontmostApplication()
        .ok_or(PlatformError::ActiveApplication)?;

    Ok(ActiveApplication {
        pid: application.processIdentifier(),
        name: application
            .localizedName()
            .map(|name| name.to_string())
            .unwrap_or_else(|| "Previous app".to_string()),
        bundle_id: application
            .bundleIdentifier()
            .map(|identifier| identifier.to_string()),
    })
}

pub fn activate_application(application: &ActiveApplication) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(application.pid)
        .map(|running| {
            running.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows)
        })
        .unwrap_or(false)
}

pub fn clipboard_text() -> Option<String> {
    let pasteboard = NSPasteboard::generalPasteboard();
    let string_type = unsafe { NSPasteboardTypeString };
    pasteboard
        .stringForType(string_type)
        .map(|value| value.to_string())
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

pub fn copy_selection(
    application: Option<&ActiveApplication>,
) -> Result<Option<String>, PlatformError> {
    if let Some(selection) = application.and_then(selected_text_via_accessibility) {
        return Ok(Some(selection));
    }

    if !post_event_trusted() {
        return Err(PlatformError::AccessibilityPermission);
    }

    let snapshot = ClipboardSnapshot::capture();
    let sentinel = format!("captura-selection-{}", Uuid::new_v4());
    let captured_text = (|| {
        write_clipboard_text(&sentinel)?;
        post_command_key(KeyCode::ANSI_C)?;

        for _ in 0..12 {
            thread::sleep(Duration::from_millis(25));
            let value = clipboard_text();
            if value.as_deref() != Some(sentinel.as_str()) {
                return Ok(value);
            }
        }

        Ok(None)
    })();
    snapshot.restore();
    let captured_text = captured_text?;

    let selection = captured_text.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    });

    Ok(selection)
}

pub fn paste_text(value: &str, target: &ActiveApplication) -> Result<(), PlatformError> {
    if !post_event_trusted() {
        return Err(PlatformError::AccessibilityPermission);
    }

    let snapshot = ClipboardSnapshot::capture();
    write_clipboard_text(value)?;

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
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| PlatformError::InputEvent)?;
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
