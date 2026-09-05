import AppKit
let args = CommandLine.arguments
func fail(_ s: String) -> Never { fputs(s+"\n",stderr);exit(1) }
guard args.count == 4, let pid = Int32(args[2]), let app = NSRunningApplication(processIdentifier:pid), app.bundleIdentifier == args[3] else { fail("PID does not match expected bundle; no action") }
let result: Bool
switch args[1] {
case "hide": result=app.hide()
case "unhide": result=app.unhide()
case "activate": result=app.activate(options:[.activateIgnoringOtherApps])
default: fail("Expected hide, unhide, or activate")
}
print("{\"accepted\":\(result),\"pid\":\(pid)}")
