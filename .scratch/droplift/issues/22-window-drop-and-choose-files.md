# 22: Window drop and "Choose files…"

**What to build:** The user can drop files on the dashboard window or click "Choose files…" to select files. Both make a Drop that follows the same routing as a Dock drop (PRD D4).

**Blocked by:** 05 (Drop → upload → link on the clipboard), 21 (Dashboard shell and Recent uploads (W3))

**Status:** ready-for-agent

- [ ] Files dropped on the dashboard window start a Batch
- [ ] "Choose files…" opens the system file picker and starts a Batch
- [ ] Both paths use the same routing as a Dock drop
