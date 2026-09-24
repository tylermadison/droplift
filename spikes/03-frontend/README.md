# PROTOTYPE: spike 03, dashboard frontend under `file://`

**This code is throwaway.** It answers one question for ticket 03 (`.scratch/droplift/issues/03-spike-dashboard-frontend-under-file.md`): can a Next.js 16 static export run as the Droplift dashboard in a **built** tinyjs app? Do not copy this code into the product. Use the decision in `ADR-frontend.md`.

| Path | What it is |
|---|---|
| `web/` | Next.js 16.3.6 app (`output: 'export'`). One client page runs these checks: API call, pushed event, ECharts, uPlot, and `#hash` views. It also has a second route, `/about/`. |
| `backend.template.js` | Host code (`ping`, `secret`, `siteUrl`, `report`). It pushes `tick` every second, writes to `/tmp/spike03-<opt>.log`, and quits after 12 s. |
| `app-a/`, `rewrite-a.mjs` | Option A: the export plus a path rewrite, loaded from `file://`. |
| `app-b/`, `app-b-bootstrap.html` | Option B: the export is served by `tjs.serve` on `127.0.0.1:<random>`, and the bridge is gated with `api.origins`. |

## Run

```sh
./run-a.sh   # builds web + the .app, runs it, prints the log
./run-b.sh   # same, and also prints the app's listening sockets (lsof)
```

Each run takes about 12 s. The page reports its status to the host, so no person needs to watch it. Results are in `NOTES.md`.
