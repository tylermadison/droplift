# 21: Dashboard shell and Recent uploads (W3)

**What to build:** The dashboard is one window with a left navigation: Overview, Uploads, Network, Storage & cost, Destinations, Settings. A Dock click when idle opens it. The Recent uploads table shows thumbnail, name, size, Destination, duration, average speed, a mini speed sparkline, and Link actions: copy, open, presign again, delete (PRD D6, §7.7, W3).

**Blocked by:** 03 (Spike: Dashboard frontend under file://), 05 (Drop → upload → link on the clipboard)

**Status:** ready-for-agent

- [ ] Left navigation with all six sections (empty sections show a placeholder)
- [ ] Launch with no files, or a Dock click when idle, opens the dashboard
- [ ] Recent uploads table shows all W3 columns from the local DB
- [ ] Link actions work: copy, open, presign again, delete
- [ ] Mini speed sparkline uses uPlot
- [ ] Light and dark mode follow the system setting
- [ ] Table works with the keyboard and VoiceOver
