# 24: Nerd strip (W1) and live throughput (W2)

**What to build:** The Overview shows the nerd strip: bytes today, uploads today, success rate, average speed, concurrency, network interface. Below it, a live throughput chart shows a rolling 60 s with one line per Provider (PRD W1, W2).

**Blocked by:** 06 (Dock progress and badge), 21 (Dashboard shell and Recent uploads (W3))

**Status:** ready-for-agent

- [ ] Stat tiles show all six W1 values from the local DB
- [ ] Live throughput chart (uPlot) shows a rolling 60 s, one line per Provider, from Engine events
- [ ] Charts work in light and dark mode
- [ ] Each chart has a table view
