# 04: Connect the first S3/R2 destination

**What to build:** On first launch the dashboard shows the empty state "Connect your first destination". The user selects S3 or R2, enters keys (or selects an AWS profile, including SSO) and a bucket, and optionally a public base URL. "Test" does a small PUT + DELETE through the Engine and must pass before "Save". The first Destination becomes the default destination. The Account secret goes to the Keychain, and the Engine gets it only on `secret.request` (PRD §10.1, R1, R2, A1–A3, A5, A6).

**Blocked by:** 02 (Spike: Engine sidecar over a Unix socket), 03 (Spike: Dashboard frontend under file://)

**Status:** ready-for-agent

- [ ] Empty state shows when there are no Destinations
- [ ] S3 form accepts access keys or a named profile from the AWS config (including SSO)
- [ ] R2 form accepts an S3-compatible token + account ID and uses the R2 endpoint with region `auto`
- [ ] "Save" is disabled until "Test" passes; a failed test shows a clear message
- [ ] The first saved Destination is the default destination
- [ ] The secret is in the Keychain (one item per Account) and nowhere else: not in files, logs, argv, or environment
- [ ] The dashboard page never receives secret values, only Account names and status
- [ ] The setup screen shows the minimum IAM policy and recommends the `AbortIncompleteMultipartUpload` lifecycle rule
- [ ] After save, the tip "Drag files onto the Droplift icon in your Dock to upload." shows

## Comments

**2026-09-24:** Frontend is Vite + React from the tinyjs `react-ts` template (ADR 0001). Not Next.js.
