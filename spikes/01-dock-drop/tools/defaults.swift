// PROTOTYPE — print the default Viewer/All handler for some content types.
import CoreServices
import Foundation
for uti in ["public.jpeg", "com.adobe.pdf", "public.zip-archive", "public.folder", "public.plain-text"] {
  let h = LSCopyDefaultRoleHandlerForContentType(uti as CFString, .all)?.takeRetainedValue() as String? ?? "(none)"
  print("\(uti) -> \(h)")
}
