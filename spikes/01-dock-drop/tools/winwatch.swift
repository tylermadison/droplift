// PROTOTYPE — polls CGWindowList every 5 ms for on-screen windows owned by a
// process name; prints the first time a window is on screen (flash detector).
import CoreGraphics
import Foundation
let owner = CommandLine.arguments[1]
let secs = Double(CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "3")!
let t0 = Date()
var first: Double? = nil
var maxCount = 0
var onMs = 0.0
while Date().timeIntervalSince(t0) < secs {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
  let mine = list.filter { ($0[kCGWindowOwnerName as String] as? String) == owner && (($0[kCGWindowLayer as String] as? Int) ?? 1) == 0 }
  if !mine.isEmpty && first == nil { first = Date().timeIntervalSince(t0) * 1000 }
  maxCount = max(maxCount, mine.count)
  if !mine.isEmpty { onMs += 5 }
  usleep(5000)
}
print(first.map { String(format: "window-onscreen-first=%.0fms maxWindows=\(maxCount) onscreen≈%.0fms", $0, onMs) } ?? "window-onscreen-first=never maxWindows=0")
