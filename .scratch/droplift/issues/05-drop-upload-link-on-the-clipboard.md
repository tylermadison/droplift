# 05: Drop → upload → link on the clipboard

**What to build:** The user drops one or more files on the Dock icon. Each file becomes one Upload to the default destination with a single PUT. The key comes from the path template. When the Batch is done, the Link (public/custom-domain URL or presigned URL) goes to the clipboard: one file → its Link, more files → one Link per line. A drop launch shows no dashboard (PRD story 1, D1, D5, R5, R6, U10, P6).

**Blocked by:** 01 (Spike: Dock drop and launch detection), 04 (Connect the first S3/R2 destination)

**Status:** ready-for-agent

- [ ] Dropping N files creates one Batch and N Uploads in SQLite
- [ ] Keys follow the path template tokens `{yyyy} {mm} {dd} {name} {ext} {hash8} {uuid}`; default `{yyyy}/{mm}/{name}-{hash8}.{ext}`
- [ ] Link type per Destination: public base URL / custom domain, or presigned URL (1 h, 1 d, 7 d)
- [ ] Clipboard gets one Link for one file, or one Link per line for many files (plain format)
- [ ] ETag and checksum are recorded for each Upload (SDK default checksums)
- [ ] Engine streams from disk and never loads a full file into memory
- [ ] A drop on cold launch does not show the dashboard
- [ ] Median drop-to-clipboard time for a 5 MB file is measured and recorded

## Comments

**2026-09-24 · from spike 01:** Use the launch shape from ticket 01: Info.plist `TinyjsActivation = accessory`, then `app.presence('normal')` in `init`. Ignore `onOpenFiles` paths inside the app bundle (tinyjs sends its own `entry.js` on every launch).
