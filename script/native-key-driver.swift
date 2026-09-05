// Actual macOS key events for an explicitly named, already-frontmost test app.
// Never activates an app or requests a permission grant.
import AppKit
import CoreGraphics

func fail(_ message: String) -> Never { fputs(message + "\n", stderr); exit(1) }
let args = Array(CommandLine.arguments.dropFirst())
func value(_ flag: String) -> String? { guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }; return args[i + 1] }
guard let target = value("--target"), NSWorkspace.shared.frontmostApplication?.bundleIdentifier == target else { fail("Target is not frontmost; no key events sent") }
guard CGPreflightPostEventAccess() else { fail("Post-event permission unavailable; no key events sent") }
let source = CGEventSource(stateID: .privateState)
var flags: CGEventFlags = []
if args.contains("--command") { flags.insert(.maskCommand) }
if args.contains("--shift") { flags.insert(.maskShift) }
if args.contains("--option") { flags.insert(.maskAlternate) }
let key = CGKeyCode(value("--key").flatMap(UInt16.init) ?? 0)
let text = value("--text")
for pressed in [true, false] {
    guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == target else { fail("Target changed; stopped key events") }
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: pressed) else { fail("Cannot create key event") }
    event.flags = flags
    if let text { let characters = Array(text.utf16); event.keyboardSetUnicodeString(stringLength: characters.count, unicodeString: characters) }
    event.post(tap: .cghidEventTap)
    usleep(15000)
}
print("{\"status\":\"native_key_events_posted\",\"contentVerified\":false}")
