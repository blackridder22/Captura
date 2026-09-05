import AppKit
import CoreGraphics
let target = CommandLine.arguments.dropFirst().first ?? "Captura"
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
if target == "--owners" {
    let names = Array(Set(windows.compactMap { $0[kCGWindowOwnerName as String] as? String })).sorted()
    print(String(data: try JSONSerialization.data(withJSONObject: ["screenCapture": CGPreflightScreenCaptureAccess(), "count": windows.count, "owners":names], options:[]), encoding:.utf8)!)
    exit(0)
}
let selected = windows.filter { ($0[kCGWindowOwnerName as String] as? String)?.lowercased() == target.lowercased() }.map { entry -> [String:Any] in
    ["id":entry[kCGWindowNumber as String] ?? 0,"title":entry[kCGWindowName as String] ?? "","pid":entry[kCGWindowOwnerPID as String] ?? 0,"bounds":entry[kCGWindowBounds as String] ?? [:],"layer":entry[kCGWindowLayer as String] ?? 0]
}
let data = try JSONSerialization.data(withJSONObject:selected,options:[.prettyPrinted,.sortedKeys])
print(String(data:data,encoding:.utf8)!)
