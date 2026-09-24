# 10: Retry with backoff

**What to build:** Retryable failures retry with exponential backoff and full jitter (base 0.5 s, max 30 s, 8 tries): 5xx, 429, S3 `SlowDown`/`RequestTimeout`, Drive rate limits. Other 4xx errors do not retry. A retried Part never re-uploads a completed Part number (PRD U5, P3, §13 R2 risk).

**Blocked by:** 09 (Multipart upload for large files)

**Status:** ready-for-agent

- [ ] Retryable errors retry with full-jitter backoff within the limits
- [ ] Non-retryable 4xx errors fail immediately
- [ ] A completed Part number is never uploaded again
- [ ] Retry count is recorded per Part and per Upload
- [ ] Progress does not go backwards during a Part retry
- [ ] Tests cover the retry decision table with fake errors
