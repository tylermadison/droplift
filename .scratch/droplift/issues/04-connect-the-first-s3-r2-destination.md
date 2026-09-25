# 04: Connect the first S3/R2 destination

**What to build:** On first launch the dashboard shows the empty state "Connect your first destination". The user selects S3 or R2, enters keys (or selects an AWS profile, including SSO) and a bucket, and optionally a public base URL. "Test" does a small PUT + DELETE through the Engine and must pass before "Save". The first Destination becomes the default destination. The Account secret goes to the Keychain, and the Engine gets it only on `secret.request` (PRD §10.1, R1, R2, A1–A3, A5, A6).

**Blocked by:** 02 (Spike: Engine sidecar over a Unix socket), 03 (Spike: Dashboard frontend under file://)

**Status:** ready-for-agent

- [x] Empty state shows when there are no Destinations
- [x] S3 form accepts access keys or a named profile from the AWS config (including SSO)
- [x] R2 form accepts an S3-compatible token + account ID and uses the R2 endpoint with region `auto`
- [x] "Save" is disabled until "Test" passes; a failed test shows a clear message
- [x] The first saved Destination is the default destination
- [x] The secret is in the Keychain (one item per Account) and nowhere else: not in files, logs, argv, or environment
- [x] The dashboard page never receives secret values, only Account names and status
- [x] The setup screen shows the minimum IAM policy and recommends the `AbortIncompleteMultipartUpload` lifecycle rule
- [x] After save, the tip "Drag files onto the Droplift icon in your Dock to upload." shows

## Comments

**2026-09-24:** Frontend is Vite + React from the tinyjs `react-ts` template (ADR 0001). Not Next.js.

**2026-09-24 · Keychain and signing:** Keychain items remember the code signature of the app that made them. An ad-hoc signature changes on every build, so macOS asks for Keychain access again after each rebuild. For development, sign with the self-signed certificate "Droplift Dev" (made in Keychain Access, no Apple account). Tests must not need the real Keychain: put the secret store behind an interface with an in-memory fake.

**2026-09-24 · implemented** (branch `ticket-04-connect-destination`, TDD)

- Tests at 3 agreed seams: Host destination API (7, Vitest + `node:sqlite`), Engine `dest.test` / `aws.profiles` over JSON-RPC (10, `go test` with a fake S3 transport), setup screen (8, Testing Library with a fake Host API).
- Manual check: a real R2 bucket passed Test and Save. The Keychain has one item (`app.droplift` / `account.1`). The database has no secret. `is_default = 1`.
- Not checked by hand: S3 with a real SSO profile (tests use a temp AWS config).
- `s3:DeleteObject` is added to the IAM policy on the screen, because Test deletes its object. PRD A2 does not list it.
- Note: in tinyjs the page can call `tiny.app.secrets` directly. A6 holds because the page code never does, and `secretFor` is not in the page API.
- Development build: `scripts/dev-build.sh` (signs with "Droplift Dev" when present).

