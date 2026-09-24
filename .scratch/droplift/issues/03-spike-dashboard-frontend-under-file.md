# 03: Spike: Dashboard frontend under file://

**What to build:** Build a small Next.js 16 static export and load it in a tinyjs window with Option A (one-route SPA + asset path rewrite) and Option B (loopback server). Select A, B, or the Vite + React fallback. Record the decision (PRD §9.4, M0d).

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Option A: page loads from `file://`, assets load, and a hash view switch works
- [x] Option B: page loads from a loopback-only server on a random port, and the `tiny` bridge is limited to that origin
- [x] A page calls one Host API method and gets one pushed event with the selected option
- [x] One ECharts chart and one uPlot chart render in the selected option
- [x] The decision (A, B, or Vite) and the reasons are written in the docs as an ADR

## Comments

**2026-09-24 · spike result** (branch `spike/m0` commit `4751c56`, `spikes/03-frontend/NOTES.md`)

- Next.js 16.3.6 Option A and Option B both passed the checks in the built app. Option A breaks Next routing, cannot load a `#hash` second window, and needs 212 rewrites that depend on Turbopack internals.
- Decision: **Vite + React** (`tinyjs new --template react-ts`). See `docs/adr/0001-dashboard-frontend-vite-react.md`.
- ECharts 6 core + one line chart is 180 KB gzip (the PRD estimate was 80–130 KB). Import ECharts through one module only.
