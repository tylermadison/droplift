# Spike 02 — verdict: PASS (notarization: needs-human)

Run: `./run.sh` on macOS 26.7, arm64, tinyjs 0.41.1 (txiki.js 26.6.0), Go 1.25.6. Date 2026-09-24.

| Acceptance criterion | Result | Evidence |
|---|---|---|
| Host listens on a socket in a private temp dir, mode 0600; starts the Engine hidden with the socket path | PASS | dir `$TMPDIR/droplift-XXXXXX` mode 700 (`tjs.makeTempDir` + `tjs.chmod`); `engine.sock` mode 600 after `tjs.chmod`; `app.spawnHidden([engine,'--socket',sock])`; connected in 7–8 ms |
| Engine connects and answers a ping; 100+ messages all arrive | PASS | 250 pings written as 250 separate writes with no await: 250/250 replies, in order, seq/count match, 6 ms. Plus 50 sequential round trips, avg 0.06–0.08 ms. Engine counted 300 at shutdown, exit 0 |
| Engine sends an event with no request | PASS | `net.state {"online":true,"pid":…,"arch":"arm64"}` received right after connect |
| Engine binary is universal, stripped, keeps exec bit in the .app | PASS | `lipo -info`: x86_64 arm64. `-ldflags "-s -w" -trimpath`, CGO off. 5.2 MB universal (2.6 MB amd64 + 2.6 MB arm64) for this stub — the real engine with aws-sdk-go-v2 + drive/v3 will be larger. `-rwxr-xr-x … droplift-engine` after `cp` + `chmod +x`. amd64 slice runs under Rosetta (`arch -x86_64` → `--socket required`) |
| Engine and .app signed with hardened runtime; notarization passes | PARTIAL: ad-hoc PASS, notarization **needs-human** | Ad-hoc: `flags=0x10002(adhoc,runtime)` on `droplift-engine`, `spike02` (launcher) and `tjs`; `codesign --verify --strict` valid; hardened app still spawns the engine and uses the socket (same PASS log). No Developer ID identity on this Mac (`security find-identity -v -p codesigning` → 0) |
| Host finds the Engine next to the Host executable at runtime | PASS | `tjs.exePath` = `…/Contents/MacOS/tjs`; engine resolved as `dirname(exePath)/droplift-engine` |
| Pass/fail note written | PASS | this file |

.app size with stub engine: 14 MB (launcher 3.0 MB + tjs 5.7 MB + engine 5.2 MB).

## Findings for the release script (ticket 34)

1. `tinyjs build` signs **ad-hoc without hardened runtime** (`tjs` showed `flags=0x2(adhoc)`). With a real `signIdentity` it adds `--options runtime --timestamp` to launcher, `<name>`, `tjs` and the .app — but not to anything we copy in afterwards.
2. So the order is: `tinyjs build` (real identity) → copy engine + `chmod +x` → sign engine → **re-sign the .app** (the copy breaks the bundle seal) → `tinyjs notarize --dmg`. `tinyjs notarize` does not rebuild; it zips the existing .app, submits, staples, and remakes the dmg — so the embedded engine survives.
3. `tinyjs notarize` refuses anything but a "Developer ID Application" signature and needs a notarytool keychain profile.
4. No entitlements needed for spawn + Unix socket under hardened runtime.

## Needs-human: notarization

Needs a paid Apple Developer account.

```sh
# 1. Once: get a "Developer ID Application" certificate into the login keychain
#    (Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application).
security find-identity -v -p codesigning     # note the "Developer ID Application: NAME (TEAMID)" string

# 2. Once: store notary credentials (app-specific password from appleid.apple.com)
xcrun notarytool store-credentials droplift-notary --apple-id YOU@EXAMPLE.COM --team-id TEAMID

# 3. Each run (from spikes/02-engine-sidecar):
export TINYJS_SIGN_IDENTITY="Developer ID Application: NAME (TEAMID)"
export TINYJS_NOTARY_PROFILE=droplift-notary
./run.sh                                      # build (real identity) → embed → sign engine, tjs, .app → run → RESULT PASS
(cd host && tinyjs notarize --dmg)            # zip existing .app → notarytool --wait → staple → dmg
APP="$(ls -d host/dist/*.app)"
spctl -a -vvv -t exec "$APP"                  # expect: accepted, source=Notarized Developer ID
open -W -n "$APP" && cat ~/Library/Logs/droplift-spike02.log   # expect RESULT PASS after stapling
```

`run.sh` signs with `TINYJS_SIGN_IDENTITY` when set (else ad-hoc), always with hardened runtime.
