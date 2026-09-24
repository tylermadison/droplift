# 11: Resume after a crash (kill test)

**What to build:** Upload state (upload ID or session URI, completed Parts) is saved in SQLite. After a crash, restart, or kill of the Host or Engine, the Queue continues from the last completed Part. If the Engine exits, the Host starts it again (max 3 times per minute) and resumes the Queue (PRD story 4, U6, §9.2, §8 Reliability).

**Blocked by:** 09 (Multipart upload for large files)

**Status:** ready-for-agent

- [ ] Kill the Engine during a multipart Upload: Host restarts it and the Upload continues from the last completed Part
- [ ] Kill the full app during a multipart Upload: on next launch the Upload continues from the last completed Part
- [ ] Host stops restarting the Engine after 3 exits in one minute and shows an error
- [ ] Resumed objects are not corrupt (checksum matches)
- [ ] Zero lost Uploads in the kill test
