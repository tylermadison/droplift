# 06: Dock progress and badge

**What to build:** During a Batch, the Dock icon shows the progress of the full Queue and a badge with the number of files that remain. Both clear when done. The Engine counts bytes on the wire and sends progress events at most every 100 ms per Upload. The Host batches them and pushes them to open windows (PRD story 3, P1, P3, P4).

**Blocked by:** 05 (Drop → upload → link on the clipboard)

**Status:** resolved

- [x] Dock progress goes from 0 to 1 over the full Queue and clears when done
- [x] Dock badge shows files that remain and clears when done
- [x] Engine sends at most one progress event per Upload every 100 ms
- [x] Host batches events and pushes `progress` to windows
- [x] Shown progress is `max(committed, in-flight)` and never goes backwards

**2026-09-24 · implemented** (branch `ticket-06-dock-progress`, TDD)

- Tests at 2 agreed seams: Engine progress events (fake clock: a steady stream, at most 1 event per 100 ms, the last event at 100%; a mutation check with no throttle fails with 66 events) and the Host queue (Dock progress 0 → 1 then cleared, badge with files that remain then cleared, one batched `progress` push per 100 ms, never backwards after a retry, and `drop` puts its files in the queue).
- Manual: the Dock progress bar shows during a 100 MB upload and clears (seen by the human).
- **Badge: not visible for `app.droplift` on this Mac.** The Host calls it correctly (a debug log showed `2` → `1` → `''`). The same build with another bundle ID shows the badge (Dock `AXStatusLabel` = `1`). `app.droplift` is not in System Settings → Notifications, and a Dock restart did not help. Cause unknown; it is macOS state for this bundle ID. Check again with the release build (ticket 34) and on another Mac.
- tinyjs quirks (report upstream): (1) after the accessory start, a badge set in about the first second is lost; (2) the launcher skips a badge text that did not change. The Host clears the badge before each set.

