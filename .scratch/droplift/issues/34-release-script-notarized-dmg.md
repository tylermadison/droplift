# 34: Release script → notarized DMG

**What to build:** One script makes the release: static frontend build, universal Engine build, tinyjs build, copy the Engine into the .app with its exec bit, patch the Info.plist document types, sign the Engine and then the .app, notarize the DMG, zip the stapled .app, compute sha256, and write the auto-update manifest (PRD §9.3).

**Blocked by:** 01 (Spike: Dock drop and launch detection), 02 (Spike: Engine sidecar over a Unix socket)

**Status:** ready-for-agent

- [ ] One command runs all §9.3 steps in order and stops on the first failure
- [ ] Engine is in the .app with its exec bit set
- [ ] Info.plist has two document types, both role Viewer, rank Alternate: `public.item` + `public.folder`, and the specific UTIs from PRD D2
- [ ] Signing identity: `TINYJS_SIGN_IDENTITY` if set; else the self-signed development certificate if present; else ad-hoc. The script prints which one it used
- [ ] Engine and .app are signed with hardened runtime (and timestamp when the identity is a Developer ID)
- [ ] Only with a Developer ID: the DMG is notarized and stapled. Without one, the script skips notarization and prints a warning
- [ ] Zip, sha256, and update manifest are written
- [ ] The .app is less than 30 MB
- [ ] The DMG installs and runs on a clean Mac (without a Developer ID: after "Open Anyway" in Privacy & Security)

## Comments

**2026-09-24 · from spikes 01 and 02:** `tinyjs build` rewrites Info.plist, so patch it after every build (document types and `TinyjsActivation = accessory`). tinyjs signs only its own binaries. Order: build → copy the Engine + `chmod +x` → sign the Engine → sign the .app again → `tinyjs notarize --dmg` (it does not build again).

**2026-09-24 · from spike 01 (F9):** The Info.plist patch needs two document types: `public.item` + `public.folder`, and a second type with specific UTIs so the app shows in Finder's Open With list. See PRD D2.

**2026-09-24:** No Developer ID now. The script must work without one (self-signed or ad-hoc, no notarization). Notarization steps from spike 02: `spikes/02-engine-sidecar/NOTES.md` on branch `spike/m0`.

**2026-09-24 · from ticket 06:** With the release build, check that the Dock badge shows during an upload. On the development Mac, macOS hides the badge for `app.droplift` (cause unknown; the code is proven with another bundle ID).

