# 05: Drop → upload → link on the clipboard

**What to build:** The user drops one or more files on the Dock icon. Each file becomes one Upload to the default destination with a single PUT. The key comes from the path template. When the Batch is done, the Link (public/custom-domain URL or presigned URL) goes to the clipboard: one file → its Link, more files → one Link per line. A drop launch shows no dashboard (PRD story 1, D1, D5, R5, R6, U10, P6).

**Blocked by:** 01 (Spike: Dock drop and launch detection), 04 (Connect the first S3/R2 destination)

**Status:** resolved

- [x] Dropping N files creates one Batch and N Uploads in SQLite
- [x] Keys follow the path template tokens `{yyyy} {mm} {dd} {name} {ext} {hash8} {uuid}`; default `{yyyy}/{mm}/{name}-{hash8}.{ext}`
- [x] Link type per Destination: public base URL / custom domain, or presigned URL (1 h, 1 d, 7 d)
- [x] Clipboard gets one Link for one file, or one Link per line for many files (plain format)
- [x] ETag and checksum are recorded for each Upload (SDK default checksums)
- [x] Engine streams from disk and never loads a full file into memory
- [x] A drop on cold launch does not show the dashboard
- [x] Median drop-to-clipboard time for a 5 MB file is measured and recorded

## Comments

**2026-09-24 · from spike 01:** Use the launch shape from ticket 01: Info.plist `TinyjsActivation = accessory`, then `app.presence('normal')` in `init`. Ignore `onOpenFiles` paths inside the app bundle (tinyjs sends its own `entry.js` on every launch).

**2026-09-24 · implemented** (branch `ticket-05-drop-upload-link`, TDD)

- Tests at 5 agreed seams: Engine `upload.enqueue` (public Link, presigned Link with TTL, file bytes + ETag + checksum), `RenderKey` (all tokens, no extension, last dot), Host `drop` (one Batch, N Uploads, clipboard one Link per line, bundle paths ignored, a failed Upload is `failed` with its message and the others finish), launch routing (400 ms timer, `entry.js` ignored), and the Link choice on the setup screen and in the Host.
- Manual, real R2 bucket: `open -a` with a file (the Dock drop event) → key `2026/09/droplift e2e-fff8a5ec.txt`, ETag and CRC64NVME checksum recorded, presigned Link on the clipboard, `curl` of the Link gives HTTP 200 and the file. No window showed.
- **Median drop to clipboard, 5 MB, app running: 1.73 s** (5 runs: 2.07, 1.73, 1.70, 1.58, 1.77). Cold launch adds about 1 s more.
- **Streaming:** Engine RSS stayed at 23 MB during a 100 MB upload.
- `hash8` is from BLAKE3 (PRD U9), `github.com/zeebo/blake3`.
- Existing databases get the new columns (`link_type`, `link_ttl`, `error_msg`) with `ALTER TABLE`.
- Not in this ticket: an Upload that was active when the app quit stays `active` (resume is ticket 11). Full error handling is ticket 14.

