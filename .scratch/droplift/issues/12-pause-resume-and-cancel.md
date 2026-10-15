# 12: Pause, resume, and cancel

**What to build:** The user can pause, resume, and cancel one Upload or all Uploads from the progress window. Cancel aborts the multipart upload on S3/R2 (PRD U7, P2).

**Blocked by:** 08 (Progress window), 09 (Multipart upload for large files)

**Status:** ready-for-agent

- [x] Pause/resume/cancel buttons on each row in the progress window
- [x] "Pause all" and "Resume all" work on the full Queue
- [x] Paused state survives an app restart
- [x] Cancel calls `AbortMultipartUpload` and leaves no incomplete multipart upload
- [ ] Dock progress and badge stay correct after pause, resume, and cancel

## Comments

**2026-10-15 · design** (branch `ticket-12-pause-resume-cancel`)

- **Decision:** a Pause is a stop that keeps the multipart upload, the same as a kill in ticket 11. A Resume is `upload.resume` with the saved state. So a Pause keeps the saved Parts, also over an app restart.
- **Decision:** the Engine gets `upload.pause {id}` and `upload.cancel {id, destination, key}`. Each stops the running call of that Upload and waits until it ends. `upload.cancel` then lists the multipart uploads of the key (`ListMultipartUploads`) and aborts each one. This also removes an upload whose ID the Host never got (a Cancel during `CreateMultipartUpload`), and the upload of a paused Upload that does not run.
- **Decision:** a stop that the user did not ask for (SIGTERM, the Host closed the socket) still keeps the multipart upload (ticket 11).
- **Decision:** new Upload states `paused` and `cancelled` in SQLite. A paused Upload gives back its turn (3 files at the same time, PRD U4), so the next file starts. At launch, `resumeActive()` runs only `active` Uploads; `paused` Uploads show in the progress window as Paused.
- **Decision:** the Dock badge counts active and paused Uploads; the Dock progress is over active, paused, done, and failed Uploads. A cancelled Upload leaves the totals.
- **Decision:** the Batch notification and the clipboard wait for the paused Uploads of the Batch; a cancelled Upload gives no Link.

**2026-10-15 · real-app test** (real app, bucket `droplift-test`, clicks with cmux desktop control)

- **Pause, upload 76.1** (`GS010002.mp4`, 20 Parts): Pause clicked at 79 MB. The row showed "Paused" and the toolbar showed "Resume all". SQLite state `paused`, 8 saved Parts. R2 kept 1 incomplete multipart upload for the key.
- **Restart:** SIGKILL to the app, then a new launch. **Bug found:** the progress window was empty, but SQLite had the Upload as `paused`. Cause: the window gets its rows only from the `progress` push. The Host pushed the paused row before the new page listened, and a paused row gets no more pushes. **Fix:** the Queue gives its current rows (`rows()`), the Host API has `progressRows`, and the page reads them when it opens (a push that comes first wins). Also, `resumeActive()` now adds the paused rows before it waits for the active Uploads (before, they showed only after all active Uploads ended). 4 new tests; vitest 77 of 77 pass; `tsc` clean.
- **After the fix:** the row showed "Paused" at 67 MB (the 8 saved Parts). Resume clicked: state `done`, checksum `LHJ05Q==-20`. Parts 1–8 kept their first `started_at`, so they were not sent again.
- **Cancel, upload 77.1:** Cancel clicked at 90 MB. The row showed "Cancelled", with no buttons and no toolbar. SQLite state `cancelled`. R2: 0 incomplete multipart uploads for the key. The object at the key is the one from upload 76.1 (LastModified 20:51:56, before the cancel at 20:52:23), so the cancel wrote no object.
- **Pause all / Resume all, batch 78** (`kill-multi-c/d/e.bin`, 40, 90, 130 MiB): "Pause all" made all 3 rows "Paused" (SQLite `paused` ×3). "Resume all" made them "Uploading". All 3 ended `done`. Each object was downloaded: SHA-256 matches the source file. R2: 0 incomplete multipart uploads.
- **Not checked yet:** the Dock badge and Dock progress in the real app (the Dock was hidden, so the test could not see it). The Queue unit tests cover them. The criterion stays open until somebody looks at the Dock.
- **Known gap:** if the app is killed during the abort of a Cancel, an incomplete multipart upload can stay. The row stays `cancelled`, and no retry happens.
- **Test note:** a macOS notice banner over the progress window takes the clicks. The first Pause click went to the banner, not to the button.
