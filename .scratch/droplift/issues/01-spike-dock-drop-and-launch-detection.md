# 01: Spike: Dock drop and launch detection

**What to build:** Make a throwaway tinyjs app that proves the Drop behaviour on macOS. Files dropped on the Dock icon or opened from Finder arrive through the open-files hook, on cold launch and when the app runs. A launch with no files shows the dashboard after the 400 ms timer. A Dock click when the app is idle shows the dashboard. The Info.plist patch lets the app accept any file type without becoming the default opener (PRD D1, D2, D5, D6, §7.1 launch detection, M0a/b).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Cold-launch drop of 1 and of 12 files: all paths arrive, and no dashboard flashes
- [ ] Warm drop (app runs): all paths arrive
- [ ] Launch with no files: dashboard shows after the 400 ms timer
- [ ] Dock click when idle: result recorded (works, or fallback needed per PRD §13)
- [ ] Info.plist patch with `public.item` + `public.folder`, role Viewer, rank Alternate: any file type drops on the icon, and the app does not become the default opener for .jpg or .pdf
- [ ] A pass/fail note for each item is written in the docs
