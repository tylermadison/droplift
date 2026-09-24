# 08: Progress window

**What to build:** A small frameless window near the Dock or top-right shows one row for each Upload: name, Destination icon, bytes/total, speed, ETA, and state. It closes 3 s after the Batch is done when there are no errors. It shows in less than 500 ms after a cold-launch drop (PRD P2, §10.2, §8 Start).

**Blocked by:** 06 (Dock progress and badge)

**Status:** ready-for-agent

- [ ] One row per Upload with name, Destination icon, bytes/total, speed, ETA, and state
- [ ] Rows update from pushed progress events
- [ ] Window closes 3 s after the Batch is done if there are no errors
- [ ] Window is visible less than 500 ms after a cold-launch drop (measured)
- [ ] All controls work with the keyboard and VoiceOver

## Comments

**2026-09-24 · from spike 03:** Select the progress window by `tiny.win.id` or give it its own HTML entry. A `#hash` page path does not load in a second window.
