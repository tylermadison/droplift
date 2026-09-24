# 02: Spike: Engine sidecar over a Unix socket

**What to build:** Prove that the Host can start the Go Engine from inside the .app and talk to it with JSON-RPC 2.0 over a Unix socket in a private temp dir (not stdin, because of the txiki.js stdin bug). The Engine binary is universal, stripped, signed with hardened runtime, and the .app is notarized (PRD §9.2, §9.3, M0c).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Host listens on a socket in a private temp dir with mode 0600 and starts the Engine hidden with the socket path
- [ ] Engine connects and answers a ping; Host sends 100+ messages and all arrive
- [ ] Engine sends an event to the Host without a request
- [ ] Engine binary is universal (arm64 + amd64), stripped, and keeps its exec bit inside the .app
- [ ] Engine and .app are signed with hardened runtime, and notarization passes
- [ ] Host finds the Engine next to the Host executable at runtime
- [ ] A pass/fail note is written in the docs
