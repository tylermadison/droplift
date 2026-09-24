# 02: Spike: Engine sidecar over a Unix socket

**What to build:** Prove that the Host can start the Go Engine from inside the .app and talk to it with JSON-RPC 2.0 over a Unix socket in a private temp dir (not stdin, because of the txiki.js stdin bug). The Engine binary is universal, stripped, signed with hardened runtime, and the .app is notarized (PRD §9.2, §9.3, M0c).

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Host listens on a socket in a private temp dir with mode 0600 and starts the Engine hidden with the socket path
- [x] Engine connects and answers a ping; Host sends 100+ messages and all arrive
- [x] Engine sends an event to the Host without a request
- [x] Engine binary is universal (arm64 + amd64), stripped, and keeps its exec bit inside the .app
- [x] Engine and .app are signed with hardened runtime (ad-hoc). Notarization moved to ticket 34.
- [x] Host finds the Engine next to the Host executable at runtime
- [x] A pass/fail note is written in the docs

## Comments

**2026-09-24 · spike result** (branch `spike/m0` commit `4751c56`, `spikes/02-engine-sidecar/NOTES.md`)

- All criteria pass except notarization. The Engine connects in 7–8 ms. 250 pings sent at once all arrived in order. The Engine sends `net.state` without a request.
- The universal stub Engine is 5.2 MB, and the .app is 14 MB. The exec bit stays set. `tjs.exePath` is `Contents/MacOS/tjs`.
- Ad-hoc signing with hardened runtime: the Engine starts and uses the socket with no entitlements.
- Release order: `tinyjs build` (real identity) → copy the Engine + `chmod +x` → sign the Engine → sign the .app again → `tinyjs notarize --dmg`.

**Remaining (human):** install a Developer ID Application certificate, `notarytool store-credentials`, then do the notarize steps in `NOTES.md`.

**2026-09-24:** Resolved for development. There is no Developer ID now. Ad-hoc signing with hardened runtime works on this Mac (see the spike result). Notarization moves to ticket 34 and runs only when a Developer ID is present. For development, use a self-signed code-signing certificate so the signature stays the same across builds (see ticket 04).
