# 14: Error map and failed Uploads

**What to build:** Errors map to a user message and one clear action (PRD §7.5 table). A failed Upload stays in the Queue as "Failed" with "Retry" and "Copy error details". Before an Upload starts, the app checks that the file can be read and the Destination has valid credentials. The Dock badge shows "!" when the Queue is empty but has failures. One notification for each Batch with failures (PRD E1–E4, §10.4).

**Blocked by:** 08 (Progress window), 10 (Retry with backoff)

**Status:** ready-for-agent

- [ ] Each error in the PRD §7.5 table shows its message and action
- [ ] Failed row goes red with a short message, "Retry", and "Copy error details"
- [ ] "Retry" restarts the Upload from the last completed Part where possible
- [ ] Preflight fails fast for an unreadable file or bad credentials
- [ ] File changed during upload is detected and shows "{file} changed during upload."
- [ ] Dock badge shows "!" when the Queue is empty but has failures
- [ ] One failure notification per Batch, not per file
