# 11: Resume after a crash (kill test)

**What to build:** Upload state (upload ID or session URI, completed Parts) is saved in SQLite. After a crash, restart, or kill of the Host or Engine, the Queue continues from the last completed Part. If the Engine exits, the Host starts it again (max 3 times per minute) and resumes the Queue (PRD story 4, U6, §9.2, §8 Reliability).

**Blocked by:** 09 (Multipart upload for large files)

**Status:** ready-for-agent

- [ ] Kill the Engine during a multipart Upload: Host restarts it and the Upload continues from the last completed Part
- [ ] Kill the full app during a multipart Upload: on next launch the Upload continues from the last completed Part
- [ ] Host stops restarting the Engine after 3 exits in one minute and shows an error
- [x] Resumed objects are not corrupt (checksum matches)
- [ ] Zero lost Uploads in the kill test

## Comments

**2026-10-13 · implemented** (branch `ticket-11-resume`, TDD)

- **Decision:** the Engine sends `upload.started` {id, key, uploadId, hash} after CreateMultipartUpload, and `part.done` now has the Part's ETag and CRC32. The Host saves them (`uploads.upload_id`, `uploads.hash`, `parts.etag`, `parts.checksum`). A new upload ID deletes the saved Parts of the old one.
- **Decision:** `upload.resume` (PRD §9.2) is `upload.enqueue` plus `resume` {key, uploadId, hash, parts}. The Engine calls ListParts and keeps only the saved Parts that the Destination has with the same ETag. It sends the other Parts, and starts progress at the committed bytes. NoSuchUpload (aborted or expired) starts a new upload on the same key. A different blake3 hash (the file changed) aborts the old upload and starts again with a new key.
- **Decision:** a cancel (SIGTERM, or the Host closed the socket) no longer aborts the multipart upload, so the next start can resume it. A real failure still aborts (ticket 09).
- **Decision:** `engine-supervisor.ts` starts the Engine again after an exit. Calls in flight fail with `EngineExitedError`, and `uploads` runs them again with the saved state; the Upload is not marked failed. After 3 exits in 60 s, calls fail with `EngineStoppedError`, the Host shows "Uploads stopped", and the Uploads stay `active`. At launch, `resumeActive()` runs every `active` Upload again.
- Tests at the agreed seams. Engine over a fake S3: `upload.started`, ETag and checksum in `part.done`, only missing Parts sent, a saved Part with a wrong ETag sent again, progress from the committed bytes, NoSuchUpload, changed file, no abort after a cancel. Host: supervisor with fake processes and a fake clock (restart, the new Engine takes the next call, 3 exits in one minute, an Engine that cannot start); `uploads` with a fake Engine (an exit runs the Upload again with the saved state, launch resume, launch with no upload ID, new upload ID, Engine stopped).

**2026-10-13 · kill test on R2** (`go test -tags realr2 -run TestKill -v ./` in `engine/`, bucket `droplift-test`)

| File | Parts | SIGKILLs | Parts sent again | Time | Object |
|---|---|---|---|---|---|
| 160 MiB random | 20 × 8 MiB | 3 (after 4 new Parts each) | 0 | 1 m 5 s | SHA-256 matches; CRC32 `EcVoQA==-20` |

- Each run started a new Engine binary and sent `upload.resume` with the saved state. Each saved Part was sent one time only. The test downloads the object and compares the SHA-256 with the file, then deletes it.
- **Not checked yet:** the full-app kill (the user does it by hand), the "Uploads stopped" notice in the app, and the Host restart with the real Engine (only the unit tests show it).
- **Not covered:** if the kill comes after a successful Complete but before its reply, the resume gets NoSuchUpload and uploads the file again (no loss, only time). Ticket 14 can check with HeadObject.
- **Note:** the app database has 6 `active` Uploads from earlier sessions. The next launch uploads them again.
