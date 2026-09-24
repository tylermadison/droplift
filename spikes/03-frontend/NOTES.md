# Spike 03: results (2026-09-24)

**Setup:** macOS 26.7 (arm64), tinyjs 0.41.1 (txiki.js 26.6.0), Next.js **16.3.6** (Turbopack build), React 19.3.0, ECharts **6.1.0**, uPlot 1.6.32.
Every result below comes from the **built** `.app` (`tinyjs build`), not from `tinyjs dev`. The page reports to the host, and the host writes `/tmp/spike03-<opt>.log`. The page also catches `window.onerror` and `unhandledrejection`.

## Pass/fail for each acceptance criterion

| Criterion | A: `file://` + rewrite | B: loopback server |
|---|---|---|
| Page loads, assets load | PASS (0 errors) | PASS (0 errors) |
| `#hash` view switch | PASS | PASS |
| Loopback only, random port | n/a (no port) | PASS: `lsof` shows only `TCP 127.0.0.1:<random> (LISTEN)` for the app, and the port changes on each launch |
| Bridge limited to that origin | n/a (every `file://` page gets the full API) | PASS: the page at `http://127.0.0.1:<port>` can call `ping` and `report`, but `secret` rejects with `"secret" is disabled by tinyjs.json "api"`. The engine reports the origin (`meta.origin`), not the page. |
| One Host API call (`ping`) | PASS | PASS |
| One pushed event (`tick`) | PASS | PASS |
| ECharts chart renders (canvas) | PASS | PASS |
| uPlot chart renders | PASS | PASS |
| Decision recorded as ADR | `ADR-frontend.md` (draft) | |

## Extra checks (these affect the decision)

| Check | A | B |
|---|---|---|
| Next routing (`router.push('/about/')`) | **FAIL, and no error**: the URL stays on `index.html` and nothing is logged | PASS: `/about/` loads and reports |
| Second window from the same build (PRD progress window) | `page: 'index.html#progress'` **never loads** (the `#` becomes part of the file path). `page: 'index.html'` works, so the page must route by `tiny.win.id` or have its hash set after load. | PASS: `page: '<siteUrl>#progress'` loads and reports as window `progress` |
| Post-build step | 212 rewrites in 18 files. It depends on Turbopack internals (`TURBOPACK_CHUNK_BASE_PATH:"/_next/"`, `"/_next/static/`). A plain replace of every `"/_next/"` **breaks** a chunk that parses script URLs with `indexOf("/_next/")`, so the rules must be narrow. | none |
| Extra host code | none | Bootstrap `file://` page, static server with a MIME map and a `..` guard (about 30 lines), and `api.origins` config |
| Launch → first report (includes charts and 0.4 s of test sleeps) | 1.05 s | 1.08 s |

## Sizes

| Item | Size |
|---|---|
| `.app` (A and B are the same size) | 10 MB (`Contents/MacOS` 8.7 MB universal launcher + tjs; frontend 1.3 MB) |
| Export `out/` | 1.4 MB on disk; all JS 376 KB gzip (every route) |
| ECharts 6 core + line + grid + tooltip + canvas | **180 KB gzip** (Turbopack) / 195 KB (webpack). One import module is required: four separate dynamic imports copied ECharts into several chunks (about 330 KB total). |
| Next + React runtime chunks | about 120 KB gzip (71 + 47) |

The ECharts size is above the PRD §9.5 estimate of 80–130 KB. The P1 widgets (heatmap, calendar, treemap, sankey, gauge, custom) will add more. The frontend is still well inside the 30 MB target (G5).

## Vite fallback cost (estimate, not built)

`tinyjs new --template react-ts` already builds with `vite build --base=./` and a devUrl dev server. So it needs no rewrite and no port. It is the path tinyjs documents. Cost to switch: replace the Next shell (layout, `next/link`, `next/navigation`) with a hash router or view state. React components and chart code do not change. The bundle is about 50 KB gzip smaller (no Next runtime). A second window from a hash has the same `#` problem as in A, and uses the same fix (route by `tiny.win.id`).
