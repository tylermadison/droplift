# 33: Settings page

**What to build:** The Settings section lets the user set: show progress window on drop, clipboard format (plain / Markdown / HTML), notifications (all / failures only / none), concurrency limits, history retention (default 180 days), and launch at login (PRD §7.8, P6).

**Blocked by:** 21 (Dashboard shell and Recent uploads (W3))

**Status:** ready-for-agent

- [ ] Each setting persists and takes effect without a restart
- [ ] Progress window off → a Drop shows no window
- [ ] Clipboard format changes the Link output (plain, Markdown, HTML)
- [ ] Notification mode is respected
- [ ] History older than the retention limit is deleted
- [ ] Launch at login works
