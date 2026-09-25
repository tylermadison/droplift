# 08: Progress window

**What to build:** A small frameless window near the Dock or top-right shows one row for each Upload: name, Destination icon, bytes/total, speed, ETA, and state. It closes 3 s after the Batch is done when there are no errors. It shows in less than 500 ms after a cold-launch drop (PRD P2, §10.2, §8 Start).

**Blocked by:** 06 (Dock progress and badge)

**Status:** resolved

- [x] One row per Upload with name, Destination icon, bytes/total, speed, ETA, and state
- [x] Rows update from pushed progress events
- [x] Window closes 3 s after the Batch is done if there are no errors
- [x] Window is visible less than 500 ms after a cold-launch drop (measured)
- [ ] All controls work with the keyboard and VoiceOver

## Comments

**2026-09-24 · from spike 03:** Select the progress window by `tiny.win.id` or give it its own HTML entry. A `#hash` page path does not load in a second window.

**2026-09-24 · implemented** (branch `ticket-08-progress-window`, TDD)

- Tests at 3 agreed seams: queue rows (name, provider, bytes, speed, ETA, state; failed rows), the queue controls the window (shows on a drop, closes 3 s after a Batch with no errors, stays open after a failure, stays open when a new drop comes in), and the `ProgressWindow` component (one row per Upload, updates on each push, a list and a labelled `progressbar` with a value).
- Manual (human screenshots): the window at the top right shows "hundred-mb.bin · R2 · Uploading", a bar, "20 MB of 105 MB · 5.5 MB/s · 16 s left", and a failed folder in red; it stays open after the failure. Closing it by hand, then a new drop, opens it again.
- **Time from a cold-launch drop to a visible window:** 454–479 ms in 7 runs (median 466 ms). An earlier set with almost the same code gave 468–637 ms (median 530 ms). The result is close to the 500 ms limit.
- **Not done:** the VoiceOver check by hand. Covered only by the role tests. There are no buttons yet (pause, cancel, and retry are tickets 12 and 14).
- tinyjs findings: (1) `openWindow` shows a new window at once, so a window cannot be made early and kept hidden (only `main` starts hidden); (2) a window opened later needed `show({ activate: false })`, or it stayed 0x0; (3) while the Keychain dialog is open, the launcher does not show new windows (first run of each development build only); (4) `app.show()` shows every window, so the dashboard uses `app.window('main').show()`.

