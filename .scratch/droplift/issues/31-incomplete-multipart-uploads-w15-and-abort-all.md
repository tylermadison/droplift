# 31: Incomplete multipart uploads (W15) and "Abort all"

**What to build:** The dashboard lists incomplete multipart uploads older than 24 h for each S3/R2 Destination and offers "Abort all" (PRD U11, W15).

**Blocked by:** 09 (Multipart upload for large files), 21 (Dashboard shell and Recent uploads (W3))

**Status:** ready-for-agent

- [ ] Engine `multipart.listIncomplete` lists incomplete uploads per bucket
- [ ] Table shows only uploads older than 24 h, with size where known
- [ ] "Abort all" aborts them and the table refreshes
- [ ] Uploads that the app will resume are not aborted
