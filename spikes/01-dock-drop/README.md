# PROTOTYPE — spike 01: Dock drop and launch detection

Throwaway code for ticket `.scratch/droplift/issues/01-spike-dock-drop-and-launch-detection.md`.
Not production. Results are in [NOTES.md](NOTES.md).

- `./run.sh` — build the tinyjs app, patch Info.plist (`public.item` + `public.folder`,
  Viewer, Alternate, and `TinyjsActivation=accessory`), ad-hoc sign, register with LaunchServices.
  `./run.sh regular` builds the stock variant (no activation patch) for comparison.
- `./test.sh` — automated checks with `open -a` (same openFiles Apple Event as a Dock drop),
  a CGWindowList watcher (`tools/winwatch`, catches window flashes), and a default-opener diff.
- Log: `~/Library/Logs/droplift-spike-01.log` (also shown in the window).
- Drop a file named `PARK` to try the Dock-click workaround (see NOTES.md).
