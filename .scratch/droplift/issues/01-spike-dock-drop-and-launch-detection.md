# 01: Spike: Dock drop and launch detection

**What to build:** Make a throwaway tinyjs app that proves the Drop behaviour on macOS. Files dropped on the Dock icon or opened from Finder arrive through the open-files hook, on cold launch and when the app runs. A launch with no files shows the dashboard after the 400 ms timer. A Dock click when the app is idle shows the dashboard. The Info.plist patch lets the app accept any file type without becoming the default opener (PRD D1, D2, D5, D6, §7.1 launch detection, M0a/b).

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [x] Cold-launch drop of 1 and of 12 files: all paths arrive, and no dashboard flashes
- [x] Warm drop (app runs): all paths arrive
- [x] Launch with no files: dashboard shows after the 400 ms timer
- [ ] Dock click when idle: result recorded (works, or fallback needed per PRD §13)
- [x] Info.plist patch with `public.item` + `public.folder`, role Viewer, rank Alternate: any file type drops on the icon, and the app does not become the default opener for .jpg or .pdf
- [x] A pass/fail note for each item is written in the docs

## Comments

**2026-09-24 · spike result** (branch `spike/m0` commit `4751c56`, `spikes/01-dock-drop/NOTES.md`)

- Cold drop (1 and 12 files) and warm drop: pass. Files arrive 140–206 ms after `init`, all in one `onOpenFiles` call.
- Stock tinyjs always shows the window at launch (390–590 ms). Fix: patch `TinyjsActivation = accessory` (no `LSUIElement`) into Info.plist, then call `app.presence('normal')` in `init`. The Dock icon comes back after about 100 ms.
- tinyjs bug: every launch sends the app's own `Resources/app/entry.js` to `onOpenFiles`. Ignore paths inside the bundle, or the 400 ms timer never shows the dashboard.
- No files: the timer fires at 401 ms, and the window is on screen at 825–1003 ms (PRD G5 limit is 1 s).
- Dock click when idle: no tinyjs hook, so a click does nothing. Workaround "park": `show({activate:false})` + `hide()` in the same tick (0–10 ms on screen). Needs a human eye check.
- Info.plist `public.item` + `public.folder`, Viewer, Alternate: pass. Default openers did not change.
- tinyjs has no Dock menu API (see ticket 20).

**Remaining (human):** the 5 manual checks in `NOTES.md` (real Dock drag, Open With list, Dock click cold and idle, park blink).

**2026-09-24 · human checks, part 1**

- Check 2 (cold Dock drop, 12 files): **pass.** The log shows one `onOpenFiles` with `real: 12` at +204 ms and no dashboard. Human saw no window and no Dock icon flicker.
- Check 4 (Open With) **failed** at first: `public.item` is a wildcard claim, and Finder hides wildcard apps from the Open With list. Fix: a second document type (Viewer, Alternate) with specific UTIs (`public.image public.movie public.audio com.adobe.pdf public.text public.archive public.zip-archive public.data`). After the fix, the app is in the list and the default openers did not change. Human confirmed in Finder. Branch `spike/m0` commit `c941550`, finding F9.
- Still open: checks 3, 5, 6, 7 (warm Dock drop, Dock click cold and idle, park blink).
