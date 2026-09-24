# Spike 01 — results (2026-09-24, macOS 26.7, tinyjs 0.41.1)

PROTOTYPE notes. Automated evidence comes from `./test.sh`: `open -a` sends the same
openFiles Apple Event as a Dock drop, and `tools/winwatch` polls CGWindowList every 5 ms.

## Verdict per acceptance criterion

| # | Criterion | Result |
|---|---|---|
| 1 | Cold-launch drop of 1 and 12 files: all paths arrive, no dashboard flash | **PASS with patch** (variant `hidden`); **FAIL on stock tinyjs** |
| 2 | Warm drop: all paths arrive | **PASS** |
| 3 | Launch with no files: dashboard after the 400 ms timer | **PASS** (timer fires at 401–402 ms; window on screen 825–1003 ms after `open`) |
| 4 | Dock click when idle | **FAIL natively**; workaround "park" works (a Dock click then shows the dashboard) but **flickers visibly** (human check 7) |
| 5 | Info.plist `public.item` + `public.folder`, Viewer, Alternate: any type accepted, not default opener | **PASS after fix (F9).** `public.item` alone: drops work, but the app is missing from Finder's Open With list (human check 4 failed) |
| 6 | Pass/fail note written | this file |

## Findings

**F1. Stock tinyjs always shows the main window at launch.** Regular variant: window on screen
388–591 ms after `open`, also on a drop launch. There is no config key for "start hidden" in a
Dock app. Only `"activation": "accessory"` starts hidden, and it also removes the Dock icon (PRD §13 risk).

**F2. Working shape (variant `hidden`):** patch `TinyjsActivation = accessory` into Info.plist
**without** `LSUIElement`, and call `app.presence('normal')` first thing in `init`.
- The launcher keeps the window hidden until `app.window('main').show()`.
- The process is `UIElement` (no Dock icon) for about 100 ms, then `Foreground` (Dock icon).
  Sampled every 100 ms: `Fo UI Fo Fo …`. **Human check:** does the Dock tile flicker?
- On drop launches the watcher saw **no window on screen** (6 of 6 cold/warm drop cases).

**F3. Spurious `onOpenFiles` on every launch.** The backend gets
`[".../DropliftSpike01.app/Contents/Resources/app/entry.js"]` at +1 ms on every launch (the
backend's own argv, forwarded as a CLI open). A naive "files arrived" flag is always true, so the
400 ms timer never shows the dashboard. Fix: ignore paths inside our own bundle. Report upstream.

**F4. Timings (cold launch, ms since backend module load).**
- `init` at +1 ms. The 400 ms timer starts there.
- Real files arrive at **+140 to +206 ms** (11 cold runs). Margin to the 400 ms timer: about 195 ms or more.
- All files arrive in **one** `onOpenFiles` call (12 of 12; 5 mixed types in 1 warm call).
- Warm drop: files arrive in about 100 ms. No window shows.
- No-file launch: dashboard on screen 825–1003 ms after `open` (400 ms timer + WebKit first paint).
  PRD G5 target is less than 1 s to first window, so this is borderline. A shorter timer is possible (files came at 206 ms or earlier).

**F5. Types.** `.png`, `.jpg`, `.pdf`, `.zip`, a folder, and a Unicode name with spaces
(`名前 ünï.txt`) all arrive with real paths. Default openers are the same before and after
registration (`public.jpeg → Preview`, `com.adobe.pdf → Preview`, `zip → Archive Utility`,
`folder → Finder`, `plain-text → TextEdit`). `tinyjs build` rewrites Info.plist, so the patch and
the ad-hoc re-sign must run after **every** build (the ticket 34 release script must do this).

**F6. Dock click (reopen) — no hook.** The launcher binary has no `reopen` handler (0 matches in
its strings), and the bridge has no activate or reopen event. Test: the app runs after a drop
(window never shown), then `open -a` with no files (the same `rapp` event as a Dock click) →
**nothing**: no event, no window. After ⌘H (NSApp hide), a reopen unhides the app, shows the
window, and fires `onWindowState {focused:true}`.

**F7. Workaround "park" (for D6).** When the app is idle and no window is on screen, call in the
**same tick** `w.show({ activate: false }); w.hide();` (main `hide()` = NSApp hide). Result: the app
is hidden with the window "visible". A later Dock click unhides the app and the dashboard shows
(94–171 ms). Measured flash: 0, 5, 10 ms on screen in 3 runs (0–2 frames). Two calls 150 ms apart
fail (the window shows). A close of the dashboard must park the app again, not only `orderOut`.
Better long-term: ask upstream for an `onReopen` hook (PRD §13).

**F8. No Dock menu API.** No `dockMenu`/`applicationDockMenu` in the bridge, the docs, or the launcher.
PRD D8 and the Dock-menu fallback for D6 are blocked without an upstream change. Outside the
scope of this ticket, but ticket 20 depends on it.

**F9. `public.item` is a wildcard claim, hidden from Open With.** Launch Services flags the app
`wildcard` and leaves it out of `NSWorkspace.urlsForApplications(toOpen:)`, which is the list Finder
uses (the app shows only under "Other…"). `open -a` and Dock drops still work. Fix in `run.sh`: a
second document type, role Viewer, rank Alternate, with `public.image public.movie public.audio
com.adobe.pdf public.text public.archive public.zip-archive public.data`. After the fix the app is in
the list for .jpg, .pdf, .txt, and a no-type .bin, and the defaults did not change (Preview, Preview,
TextEdit, Archive Utility).

## Manual checks for the user (things automation cannot see)

**The log** is the file `~/Library/Logs/droplift-spike-01.log`. The window stays hidden on a drop,
so read the log in a second terminal: `tail -f ~/Library/Logs/droplift-spike-01.log`. Ignore the
`onOpenFiles` line with `real: 0` and the path `entry.js` (F3).

1. `./run.sh`, then open `app/dist/DropliftSpike01.app` once and select "Keep in Dock". Quit it.
2. **Cold Dock drop:** drag 12 files from Finder onto the Dock icon. Expect: no window, no Dock
   icon flicker. Check the log: one `onOpenFiles` with `real: 12`.
3. **Warm Dock drop:** with the app running, drag a folder and a `.pdf` onto the Dock icon. Expect: no window.
4. **Finder:** right-click a `.jpg` → Open With → DropliftSpike01 is in the list but is not the
   default. Double-click the `.jpg`: it still opens in Preview.
5. **Dock click with no files (app not running):** click the Dock icon. Expect: dashboard after
   about 0.5–1 s, with no blink before it.
6. **Dock click when idle (confirm F6):** `open -a app/dist/DropliftSpike01.app fixtures/doc.pdf`,
   then click the Dock icon. Expect: nothing happens (this is the failure).
7. **Park workaround (F7):** quit, then `open -a app/dist/DropliftSpike01.app fixtures/PARK`
   (run `./test.sh` once to make `fixtures/`). Watch the screen for a blink about 1 s later.
   Then click the Dock icon. Expect: the dashboard shows.
