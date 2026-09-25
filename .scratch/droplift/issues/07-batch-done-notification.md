# 07: Batch-done notification

**What to build:** When a Batch is done, the app sends one notification: "12 files uploaded · 84 MB · 6.2 s" with the actions "Copy links", "Open", and "Show in dashboard" (PRD story 5, P5).

**Blocked by:** 05 (Drop → upload → link on the clipboard)

**Status:** resolved

- [x] Exactly one notification for each Batch, not one for each file
- [x] Text shows file count, total size, and duration
- [x] "Copy links" puts the Batch Links on the clipboard
- [x] "Open" opens the Link (one file) or the Links (many files) in the browser
- [x] "Show in dashboard" opens the dashboard

**2026-09-24 · implemented** (branch `ticket-07-batch-notification`, TDD)

- Tests at 3 agreed seams: `drop` sends one notification for each Batch ("2 files uploaded · 84 MB · 6.2 s", "1 file uploaded · 2.5 MB · 0.8 s", sizes in decimal units as Finder shows them); the 3 actions by Batch ID from SQLite (Copy links, Open each Link, Show in dashboard); the Engine result has `size`.
- Manual (human): the notification showed; Copy links put the Links on the clipboard; Open opened both Links (the browser downloaded the files, as R2 presigned Links serve them); Show in dashboard showed the window.
- A Batch with failures gets its own notification in ticket 14 (E3). For now the count covers the files that finished.

