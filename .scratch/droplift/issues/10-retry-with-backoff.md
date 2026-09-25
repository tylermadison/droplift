# 10: Retry with backoff

**What to build:** Retryable failures retry with exponential backoff and full jitter (base 0.5 s, max 30 s, 8 tries): 5xx, 429, S3 `SlowDown`/`RequestTimeout`, Drive rate limits. Other 4xx errors do not retry. A retried Part never re-uploads a completed Part number (PRD U5, P3, §13 R2 risk).

**Blocked by:** 09 (Multipart upload for large files)

**Status:** resolved

- [x] Retryable errors retry with full-jitter backoff within the limits
- [x] Non-retryable 4xx errors fail immediately
- [x] A completed Part number is never uploaded again
- [x] Retry count is recorded per Part and per Upload
- [x] Progress does not go backwards during a Part retry
- [x] Tests cover the retry decision table with fake errors

## Comments

**2026-09-25 · implemented** (branch `ticket-10-retry`, TDD)

- **Decision:** the Engine does its own retries (`engine/retry.go`); the SDK tries each call once (`aws.NopRetryer`). `Options.Sleep` and `Options.Jitter` can be replaced in tests, so the tests are fast and exact. Create, each Part, Complete, and the single PUT each go through the same loop.
- **Decision:** network errors with no HTTP status (connection reset, timeout) retry like a 5xx. Ticket 13 adds the pause when the network is fully down. A cancelled context does not retry.
- Tests at 2 agreed seams. Engine `upload.enqueue` over a fake S3 with a fake sleep and jitter: the decision table (500, 503, 429, 400 `RequestTimeout`, 400 `SlowDown`, network error → retry; 403 `AccessDenied`, 404 `NoSuchBucket`, 400 `InvalidArgument` → 1 try), the waits 0.5, 1, 2, 4, 8, 16, 30 s at maximum jitter, a quarter of the backoff at jitter 0.25, the stop after 8 tries, only the failed Part sent again (Part 2 three times, Parts 1 and 3 one time), retries in `part.done`, in the result, and in `error.data` of a failed Upload, and progress that never goes back (single PUT and Part). Host `uploads.drop` → `listUploads`: `retries` for a done and a failed Upload (new column, with the `ALTER TABLE` check).
- Progress (PRD P3): the Engine sends the highest value so far, so a rewound body does not show as a step back.
- R2 risk (PRD §13): a retry sends the same Part number with the same fixed size; completed Part numbers are never sent again.
- **Not covered:** a Part that fails after all 8 tries gets no Part row (the Upload row has the retries, and the multipart upload is aborted). Drive rate limits (`rateLimitExceeded`, `userRateLimitExceeded`) wait for tickets 15/16; add them to `retryable`.
- **Not checked on the real bucket:** the user chose to skip a real upload. A real R2 error cannot be forced, so only the tests show the retries.
