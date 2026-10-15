# 11: Resume after a crash (kill test)

**What to build:** Upload state (upload ID or session URI, completed Parts) is saved in SQLite. After a crash, restart, or kill of the Host or Engine, the Queue continues from the last completed Part. If the Engine exits, the Host starts it again (max 3 times per minute) and resumes the Queue (PRD story 4, U6, §9.2, §8 Reliability).

**Blocked by:** 09 (Multipart upload for large files)

**Status:** resolved

- [x] Kill the Engine during a multipart Upload: Host restarts it and the Upload continues from the last completed Part
- [x] Kill the full app during a multipart Upload: on next launch the Upload continues from the last completed Part
- [x] Host stops restarting the Engine after 3 exits in one minute and shows an error
- [x] Resumed objects are not corrupt (checksum matches)
- [x] Zero lost Uploads in the kill test

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

**2026-10-13 · full-app kill test** (real app, bucket `droplift-test`, file `GS010002.mp4`, 162 081 953 bytes, 20 Parts)

- The app was killed with SIGKILL after 4 Parts (32 MiB). The database kept the upload ID, the hash, and Parts 1–4 with their ETags and CRC32.
- After the next launch, Parts 5–20 were sent. Parts 1–4 kept their first `started_at` (23:21:43), so they were not sent again.
- Upload state `done`, 0 retries, checksum `LHJ05Q==-20`.
- The object was downloaded and its SHA-256 matches the source file (`8f9544a1…bbc1ec`).
- Setup for this run: the default destination's account record gets `"profile":"r2"`, so the app uses `~/.aws/credentials` instead of the old Keychain keys. The Keychain keys are still there.
- **Not checked yet:** kill of the Engine alone in the real app, the "Uploads stopped" notice after 3 exits, and zero lost Uploads with several files.

**2026-10-14 · Engine kill and several-files tests** (real app, bucket `droplift-test`)

- **Engine kill, upload 63.1** (`GS010002.mp4`, 20 Parts): SIGKILL to the Engine after 13 finished Parts. The Host started a new Engine, and the Upload continued. The 13 saved Parts kept their first `started_at`, so they were not sent again. State `done`, 0 retries, checksum `LHJ05Q==-20`.
- **Engine kill, repeated** (uploads 64.1, 65.1, 67.1–71.1): app started from a shell so the Engine's stderr was captured; file dropped with `open -a`; SIGKILL to the Engine after 6–20 s (0 to 9 Parts finished). 7 of 7 runs: one restart, Upload `done`, checksum `LHJ05Q==-20` (the same object as the SHA-256 check of 2026-10-13), no Engine stderr.
- **3 exits in 60 s:** three SIGKILLs to an idle Engine at 13:40:03, 13:40:16, and 13:40:28. After the first two, a new Engine started. After the third, no Engine started. The notice "Uploads stopped" was **not seen** (the test ran from a shell with nobody at the screen), so the criterion stays open.
- **Several files, full-app kill** (batches 72 and 73): 5 random files (1, 6, 40, 90, 130 MiB), dropped together; SIGKILL to the app after 12 s (batch 72) and after 25 s (batch 73, the three multipart files had 4 saved Parts each). After relaunch: 5 of 5 rows `done` in each batch, 0 lost, 0 retries, no saved Part sent again. All 10 objects downloaded: SHA-256 matches the source files.
- **Unexplained exit (seen one time):** in the first run of 2026-10-14, Engine 2 (started after the user's kill at 13:35:43) closed at 13:36:08 without a kill. With the kills at 13:35:43 and 13:36:17, this made 3 exits in 60 s, and the Host stopped as designed. Its stderr was lost because `open` started the app. 7 repro runs with stderr captured did not show it again. **Cause unknown.** If it comes back, the Engine's stderr must be kept (for example, written to a log file by the Host) to find the cause.
- **Note:** an Engine started by `open` writes its stderr nowhere. Ticket 14 (error map) or a logging ticket should save it to a file.

**2026-10-15 · resolved**

- The user opened the app the normal way and killed the Engine 3 times within one minute. The macOS notice "Uploads stopped" appeared. All five criteria are now shown in the real app.
- Open follow-ups: the unexplained Engine exit (seen one time, cause unknown), Engine stderr is not saved, and the risk of a kill between Complete and its reply (ticket 14).
