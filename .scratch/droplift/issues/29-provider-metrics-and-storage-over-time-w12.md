# 29: Provider metrics and storage over time (W12)

**What to build:** The Engine fetches storage metrics from each Provider: S3 CloudWatch daily `BucketSizeBytes`/`NumberOfObjects`, R2 GraphQL storage groups (with the optional analytics token), and Drive `storageQuota`. Metrics are cached in SQLite, refreshed every 15 minutes while the dashboard is open and on demand. The chart shows storage over time with a quota projection and the age of each metric (PRD story 7, W12, A3, §7.7 rules).

**Blocked by:** 15 (Connect Google Drive), 21 (Dashboard shell and Recent uploads (W3))

**Status:** ready-for-agent

- [ ] Engine `metrics.fetch` works for S3, R2, and Drive
- [ ] Metrics are cached in SQLite
- [ ] Refresh every 15 minutes when the dashboard is open, and on a "Refresh" click
- [ ] Each metric shows its age (for example "CloudWatch data: 1 day old")
- [ ] S3 paid request metrics are off by default
- [ ] Area chart shows storage over time with a quota projection; light/dark; table view
