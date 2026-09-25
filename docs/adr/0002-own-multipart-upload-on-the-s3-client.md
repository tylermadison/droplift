# 0002: Own multipart upload on the S3 client, not the transfer manager

**Status:** Accepted. **Date:** 2026-09-24. **Source:** ticket 09; source of `github.com/aws/aws-sdk-go-v2/feature/s3/transfermanager` v0.4.10 (`api_op_UploadObject.go`, `options.go`).

## Context

PRD U1 asked for `aws-sdk-go-v2` `feature/s3/transfermanager`. Version v0.4.10 (pre-1.0) exists and uses the same SDK versions as the Engine. Its upload code shows four problems for Droplift:

- **Memory:** it copies each Part into a buffer from a pool of Part size × (Concurrency + 1), and it reads the first `MultipartUploadThreshold` bytes (16 MiB) into memory. For 3 files × 4 Parts × 8 MiB this is approximately 120–150 MB of buffers. PRD §8 allows 150 MB RSS for Host + Engine together.
- **Progress:** it reports bytes only when a full Part is done (steps of 8 MiB). PRD P3/P4 need a smooth value every 100 ms.
- **Part events:** it gives no per-Part start, end, or retry count. PRD §9.2 (`part.done`), §9.6 (`parts`), and ticket 27 (waterfall) need them.
- **Resume:** it always calls `CreateMultipartUpload`. It cannot continue an existing upload ID, which PRD U6 and ticket 11 need.

## Decision

The Engine does multipart with the S3 client calls `CreateMultipartUpload`, `UploadPart`, and `CompleteMultipartUpload` (`engine/multipart.go`). Each Part body is an `io.SectionReader` on the open file, so no Part is held in memory, and a retry can seek back. The Engine keeps the 16 MiB limit, the Part size formula, the Parts-per-file limit, per-Part progress, and `part.done` events. Checksums: CRC32 per Part (the SDK default algorithm), given to `CompleteMultipartUpload`.

Rejected: the transfer manager (reasons above). A wrapper around it would fix the Part events, but not the buffers or resume.

## Consequences

- PRD U1 is changed to name this approach.
- Approximately 100 lines of our own code, with tests at `upload.enqueue` over a fake S3 (`engine/multipart_test.go`).
- A failed Upload (a Part or the Complete call) aborts its multipart upload, so no Parts stay on the Destination. Ticket 11 replaces the abort with a saved upload ID and a resume.
- Ticket 11 can resume: it gives a saved upload ID and the completed Part numbers, and sends only the missing Parts.
- Ticket 10 (retry with backoff) can replace the SDK retryer for `UploadPart` without a fight with a library loop.
- We do not get transfer manager improvements for free. Check the transfer manager again when it reaches v1 if these points change.
