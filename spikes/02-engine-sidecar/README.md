# PROTOTYPE — Spike 02: Engine sidecar over a Unix socket

Throwaway code. Do not import into the real app. Answers ticket
`.scratch/droplift/issues/02-spike-engine-sidecar-over-a-unix-socket.md`.

- `engine/` — Go stand-in engine: `--socket <path>`, newline-delimited JSON-RPC 2.0 (`ping`, `shutdown`), sends `net.state` on connect.
- `host/` — tinyjs app: private temp dir (0700) → `tjs.listen('pipe')` socket (0600) → `app.spawnHidden(engine, ['--socket', path])` → 250 burst pings + 50 sequential pings.
- `./run.sh` — builds everything, embeds the engine in the .app, ad-hoc signs with hardened runtime, launches, waits, prints the log, exits 0 on `RESULT PASS`.

Result log (no human needed): `~/Library/Logs/droplift-spike02.log`.
Keep the window open: `SPIKE_KEEP_OPEN=1` only works under `tinyjs dev`
(`cd host && DROPLIFT_ENGINE=../out/droplift-engine SPIKE_KEEP_OPEN=1 tinyjs dev`).

Verdict and evidence: `NOTES.md`.
