# 32: Duplicate detection (U9)

**What to build:** The Engine computes a BLAKE3 content hash for each file. If the same hash was uploaded to the same Destination and the object still exists (HEAD), the app gives the old Link immediately and marks the Upload "skipped — duplicate" (PRD story 10, U9).

**Blocked by:** 05 (Drop → upload → link on the clipboard)

**Status:** ready-for-agent

- [ ] Engine computes a BLAKE3 hash, streamed from disk
- [ ] Same hash + same Destination + object exists → old Link, Upload marked "skipped — duplicate"
- [ ] Object deleted in the bucket → the file uploads again
- [ ] Skipped Uploads show in the progress window, notification, and clipboard
