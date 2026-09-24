# 03: Spike: Dashboard frontend under file://

**What to build:** Build a small Next.js 16 static export and load it in a tinyjs window with Option A (one-route SPA + asset path rewrite) and Option B (loopback server). Select A, B, or the Vite + React fallback. Record the decision (PRD §9.4, M0d).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Option A: page loads from `file://`, assets load, and a hash view switch works
- [ ] Option B: page loads from a loopback-only server on a random port, and the `tiny` bridge is limited to that origin
- [ ] A page calls one Host API method and gets one pushed event with the selected option
- [ ] One ECharts chart and one uPlot chart render in the selected option
- [ ] The decision (A, B, or Vite) and the reasons are written in the docs as an ADR
