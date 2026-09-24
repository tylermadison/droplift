# 13: Network loss and sleep/wake

**What to build:** When the network goes away, the Queue pauses and shows "Waiting for network…". When the network comes back, the Queue continues automatically. When the Mac goes to sleep, the Queue pauses and continues on wake (PRD story 4, U8, E5).

**Blocked by:** 12 (Pause, resume, and cancel)

**Status:** ready-for-agent

- [ ] Engine sends `net.state` when the network changes
- [ ] Network loss pauses the Queue and rows show "Waiting for network…"
- [ ] Network return resumes the Queue with no user action, from the last completed Part
- [ ] Sleep pauses the Queue; wake resumes it
- [ ] Test: turn off Wi-Fi during a large Upload, turn it on, and the Upload completes
