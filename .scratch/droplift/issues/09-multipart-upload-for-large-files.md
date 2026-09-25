# 09: Multipart upload for large files

**What to build:** Files of 16 MiB and more upload as multipart with the S3 transfer manager. Part size is `max(8 MiB, ceil(size / 10000))`, and every Part except the last has the same size (R2 rule). The Queue runs at most 3 files at the same time and at most 4 Parts per file. Each Part is recorded in SQLite (PRD U1, U2, U4, §8 Throughput/Memory).

**Blocked by:** 05 (Drop → upload → link on the clipboard)

**Status:** resolved

- [x] Files below 16 MiB use a single PUT; files of 16 MiB and more use multipart
- [x] Part size follows the formula; all Parts except the last are the same size
- [x] R2 accepts the upload (checksum mode `WHEN_REQUIRED` if R2 refuses the SDK default)
- [x] Max 3 files and 4 Parts per file at the same time (configurable)
- [x] Each Part row records size, start, end, retries, and speed
- [x] 1 GB file: speed is at least 90% of `aws s3 cp` on the same network (measured)
- [x] Host + Engine stay below 150 MB RSS during 10 parallel Uploads

## Comments

**2026-09-25 · implemented** (branch `ticket-09-multipart`, TDD)

- **Decision (ADR 0002):** own multipart on the S3 client (`CreateMultipartUpload` / `UploadPart` / `CompleteMultipartUpload`), not `feature/s3/transfermanager` v0.4.10. The transfer manager copies each Part into a memory buffer, reports progress only per full Part, gives no Part events, and cannot continue an existing upload ID (ticket 11). PRD U1 is changed. Each Part body is an `io.SectionReader` on the file.
- **Decision:** the 3-files limit is in the Host (one limiter for all Drops, `filesAtOnce`, default 3). The 4-Parts limit is in the Engine (`partsPerFile` in `upload.enqueue`, default 4). There is no settings UI yet (ticket 33).
- Tests at 3 agreed seams. Engine `upload.enqueue` over a fake S3: the 16 MiB limit (16 MiB − 1 byte is one PUT), Parts of 8, 8, 4 MiB for 20 MiB, max 4 (or `partsPerFile`) Parts in flight, progress is the sum over the Parts and ends at the total, `part.done` per Part (size, times, speed), retries per Part (an SDK retry of a 500 gives `retries: 1`), the checksum of the completed object, and a failed Part stops the Upload with the clear message. Host `uploads.drop` with a fake Engine: max 3 files in flight, also over 2 Drops. Host `part.done` → `uploads.listParts`.
- **Not tested:** the `ceil(size / 10000)` branch of the Part size (files above approximately 78 GiB). A test through the seam must read the full file. It is in the code (`partSize`) only.
- **R2 accepts the upload** with CRC32 per Part (the SDK default; `WHEN_REQUIRED` was not necessary). 100 MiB: 13 Parts (12 × 8 MiB + 4 MiB), 4 in flight at all times, 0 retries, ETag `…-13`, checksum `…==-13`. The object downloaded with the Link has the same SHA-256 as the local file.
- **Throughput, 1 GB** (same network, alternating runs; `aws s3 cp` with its defaults: 8 MiB Parts, 10 requests in parallel):

  | Run | `aws s3 cp` | Droplift | Droplift ÷ aws |
  |---|---|---|---|
  | 1 | 221.4 s (4.62 MiB/s) | 224.9 s (4.55 MiB/s) | 98% |
  | 2 | 246.2 s (4.16 MiB/s) | 233.6 s (4.38 MiB/s) | 105% |
  | Mean | 233.8 s | 229.2 s | **102%** |

  Droplift: 128 Parts, 0 retries; the time includes the BLAKE3 hash pass. Both tools were limited by the network upload speed (approximately 37 Mbit/s). Measure again on a faster line if one is available.
- **RSS, 10 parallel Uploads of 50 MiB** (70 Parts, 0 retries, 110 s): peak 128.5 MB for all 3 processes together (launcher 90.4 MB, Host `tjs` 10.0 MB, Engine 28.7 MB). Limit: 150 MB.
- Fix found in the real run: the Engine sent Part times in local time; they are now UTC, like the `uploads` table.
- Finding: 6 old `uploads` rows stay `active` from earlier sessions where the app stopped during an Upload. Ticket 11 (resume) handles such rows.
