# 27: Part waterfall (W5) and latency histogram (W6)

**What to build:** For one Upload, a waterfall shows start → end for each Part, colored by retry count. A latency histogram / box plot shows p50/p95/p99 per Provider for time per Part and time to first byte (PRD story 8, W5, W6).

**Blocked by:** 09 (Multipart upload for large files), 21 (Dashboard shell and Recent uploads (W3))

**Status:** ready-for-agent

- [ ] Waterfall (ECharts custom series) shows each Part of one Upload, colored by retry count
- [ ] Latency chart shows p50/p95/p99 per Provider for time per Part and time to first byte
- [ ] Time to first byte is recorded by the Engine
- [ ] Light and dark mode; table view
