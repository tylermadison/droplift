# 35: Auto-update

**What to build:** The app checks for updates daily and installs them from the manifest that the release script writes (PRD §7.8 auto-update, M5).

**Blocked by:** 34 (Release script → notarized DMG)

**Status:** ready-for-agent

- [ ] App checks the update manifest daily
- [ ] A new version downloads, verifies sha256, and installs
- [ ] Test: install version N on a clean Mac, publish N+1, and the app updates
