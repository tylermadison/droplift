# ADR (draft): Dashboard frontend build (Vite + React)

**Status:** Proposed (spike 03). **Date:** 2026-09-24.

## Context

PRD §9.4 asked for Next.js 16 if possible. A tinyjs built app loads its page from `file://`, and Next writes absolute `/_next/` asset paths. Spike 03 tested both workarounds in a built `.app`. Evidence is in `NOTES.md`.

- **Option A (one-route SPA + path rewrite):** Works for one page. But the rewrite depends on Turbopack internals: 212 edits in 18 files, and one Next chunk breaks if the rewrite is too broad. `next/navigation` routing fails with no error. A second window cannot use a `#hash` page path.
- **Option B (loopback server):** Everything works, including Next routing and a second window from the same build. The server binds only to `127.0.0.1` on a random port, and `api.origins` gates the bridge, which the spike proved. Cost: one TCP port, which tinyjs normally avoids ("No HTTP server, no ports"). It also needs a bootstrap page and a small static server in the Host.
- **Vite + React:** The path tinyjs documents (`--template react-ts`, `base: './'`). It needs no rewrite and no port. The dashboard uses no Next server features (PRD §9.4), so Next adds only a runtime (about 50 KB gzip) and a file-loading problem.

## Decision

Use **Vite + React** (the PRD fallback). Switch views with client state or `#hash`. Route secondary windows (progress, ⌥ picker) by `tiny.win.id`, or by a separate HTML entry for each window.

If Next.js is a hard requirement, use **Option B**, not A. B works fully and does not depend on Next internals.

## Consequences

- No post-build rewrite that can break silently on a Next upgrade. No local port to secure.
- The page runs from `file://`, so every window has the full Host API with no origin gate. Keep all secret handling in the Host (PRD A5, A6) as planned.
- Next routing is not available. Views use a hash router or view state.
- The chart and React component code from this spike transfers without change.
- Size: ECharts 6 core + one line chart is about 180 KB gzip, more than the PRD estimate (80–130 KB). Import ECharts through **one** module (separate dynamic imports copied it into several chunks). Update PRD §9.5.
- Ticket 04 and ticket 21 start from `tinyjs new --template react-ts`.
