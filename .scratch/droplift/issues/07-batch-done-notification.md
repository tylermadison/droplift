# 07: Batch-done notification

**What to build:** When a Batch is done, the app sends one notification: "12 files uploaded · 84 MB · 6.2 s" with the actions "Copy links", "Open", and "Show in dashboard" (PRD story 5, P5).

**Blocked by:** 05 (Drop → upload → link on the clipboard)

**Status:** ready-for-agent

- [ ] Exactly one notification for each Batch, not one for each file
- [ ] Text shows file count, total size, and duration
- [ ] "Copy links" puts the Batch Links on the clipboard
- [ ] "Open" opens the Link (one file) or the Links (many files) in the browser
- [ ] "Show in dashboard" opens the dashboard
