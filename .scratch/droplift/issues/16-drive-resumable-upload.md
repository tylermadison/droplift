# 16: Drive resumable upload

**What to build:** Files upload to a Drive Destination with a resumable session in 16 MiB chunks. On failure, the Engine queries the offset and continues. On 404, it starts a new session. The session URI is saved in SQLite so the Upload resumes after a crash. The Link is the Drive web link (PRD U3, U6, R6).

**Blocked by:** 11 (Resume after a crash (kill test)), 15 (Connect Google Drive)

**Status:** ready-for-agent

- [ ] Uploads use resumable sessions with 16 MiB chunks (a multiple of 256 KiB)
- [ ] After a failure, the Engine queries the offset and continues from it
- [ ] On 404, the Engine starts a new session
- [ ] Kill test: a Drive Upload resumes after an app kill
- [ ] Drive rate-limit errors retry; `storageQuotaExceeded` shows "Your Google Drive is full."
- [ ] Link is the Drive web link
