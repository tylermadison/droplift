# 12: Pause, resume, and cancel

**What to build:** The user can pause, resume, and cancel one Upload or all Uploads from the progress window. Cancel aborts the multipart upload on S3/R2 (PRD U7, P2).

**Blocked by:** 08 (Progress window), 09 (Multipart upload for large files)

**Status:** ready-for-agent

- [ ] Pause/resume/cancel buttons on each row in the progress window
- [ ] "Pause all" and "Resume all" work on the full Queue
- [ ] Paused state survives an app restart
- [ ] Cancel calls `AbortMultipartUpload` and leaves no incomplete multipart upload
- [ ] Dock progress and badge stay correct after pause, resume, and cancel
