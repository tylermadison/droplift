# PRD: Droplift — drop-to-upload desktop app (tinyjs)

| Field | Value |
|---|---|
| Status | Draft v0.1 |
| Author | Tyler Madison |
| Date | 2026-09-24 |
| Platform | macOS 14+ (Windows and Linux: later, tinyjs support is beta) |
| Stack | tinyjs 0.41.1 (txiki.js 26.6.0 + system WebKit) · Go sidecar (upload engine) · Vite + React (dashboard, ADR 0001) · Apache ECharts 6 + uPlot (charts) |

"Droplift" is a working name.

---

## 1. Summary

Droplift is a small macOS app. The user drops one or more files on the app icon in the Dock or in Finder. The app uploads the files to one or more configured cloud storage destinations (AWS S3, Cloudflare R2, Google Drive). It shows the upload progress, retries failures, and copies a link when the upload is done.

When the user opens the app with no files, the app shows a dashboard. The dashboard shows the connected storage accounts, recent uploads, network statistics, and detailed charts for technical users.

## 2. Problems to solve

1. Uploading a file to S3, R2, or Drive takes too many steps (open console or web UI, find the bucket, upload, copy a link).
2. Command-line tools (`aws s3 cp`, `rclone`) do not give a fast, visual flow for one-off files.
3. Users do not see how their uploads perform (speed, retries, errors) or what their storage costs.

## 3. Goals and non-goals

### Goals
- G1. Drop N files on the Dock icon → all files upload to the correct destinations with no more clicks.
- G2. Clear progress for each file and for the full batch, on the Dock icon and in a small progress window.
- G3. Reliable uploads: retry with backoff, resume after network loss, clear error messages.
- G4. A dashboard with account data, recent uploads, and detailed charts.
- G5. Keep the app small and fast (target: less than 30 MB installed, less than 1 s to first window).

### Non-goals (v1)
- Two-way sync or a mounted drive (use Cyberduck/Mountain Duck for that).
- Download manager or file browser for full buckets.
- Windows and Linux builds.
- Team accounts, sharing permissions, or a hosted web version.
- Image editing (resize, EXIF strip) — see Future.

## 4. Glossary (ubiquitous language)

Use these words the same way in code, UI, and docs.

| Term | Meaning |
|---|---|
| **Destination** | One configured place to upload to: provider + account + bucket/folder + path template. Example: "R2 · personal · `public-assets/{yyyy}/{mm}/`". |
| **Provider** | The storage service type: `s3`, `r2`, `gdrive`. |
| **Account** | The credentials for one provider login (keys, SSO profile, or OAuth token). One account can have many destinations. |
| **Drop** | One user action that gives the app one or more files (Dock icon, Finder "Open With", window drop, or file picker). |
| **Batch** | All the uploads made from one drop. |
| **Upload** | One file sent to one destination. One file sent to 2 destinations = 2 uploads. |
| **Part** | One piece of a multipart upload (S3/R2) or one chunk of a resumable upload (Drive). |
| **Rule** | A condition that selects destinations for a file (file type, size, modifier key). |
| **Default destination** | The destination used when no rule matches. |
| **Queue** | All uploads that are waiting, active, paused, or failed. |
| **Link** | The URL the app gives for a completed upload: public URL, custom-domain URL, presigned URL, or Drive web link. |
| **Engine** | The Go sidecar process that does the uploads. |
| **Host** | The tinyjs backend (txiki.js) that owns windows, Dock, notifications, Keychain, and the engine process. |

## 5. Users

- **Primary: developer / technical user.** Has AWS or Cloudflare accounts. Uploads screenshots, builds, logs, videos, and datasets. Likes numbers and charts.
- **Secondary: creator / power user.** Uses Google Drive. Wants "drop and get a link" with no setup after the first time.

## 6. User stories

1. As a user, I drop 12 screenshots on the Dock icon, and each one uploads to my R2 bucket. The link of the last file (or all links as a list) goes to my clipboard.
2. As a user, I hold ⌥ when I drop, and the app asks me which destinations to use.
3. As a user, I see a progress bar on the Dock icon and a badge with the number of files that remain.
4. As a user, I lose Wi-Fi during a 4 GB upload. When the network comes back, the upload continues from the last good part.
5. As a user, I get one notification when the batch is done, with "Copy links", "Open", and "Show in dashboard".
6. As a user, I click the Dock icon with no files, and the dashboard opens.
7. As a user, I see my R2 storage use, request counts, and an estimated monthly cost.
8. As a user, I see the throughput of each upload over time and which parts were retried.
9. As a user, I connect Google Drive by signing in through my browser. I do not paste tokens.
10. As a user, I drop a file that I uploaded before, and the app gives me the old link immediately.

## 7. Functional requirements

Priority: **P0** = v1 must have, **P1** = v1 should have, **P2** = later.

### 7.1 Drop and launch behavior

| ID | Requirement | Pri |
|---|---|---|
| D1 | Accept files dropped on the Dock icon and on the app icon in Finder, on cold launch and when the app runs. Use the tinyjs backend hook `onOpenFiles(paths, app)` (launch events are buffered until the app is ready). | P0 |
| D2 | Accept any file type. The `Info.plist` must declare `LSItemContentTypes = public.item` with role **Viewer** and rank **Alternate**, so the app never becomes the default opener for `.jpg`, `.pdf`, etc. `public.item` is a wildcard claim, and Finder hides wildcard apps from the Open With list, so also declare a second type (Viewer, Alternate) with specific UTIs: `public.image`, `public.movie`, `public.audio`, `com.adobe.pdf`, `public.text`, `public.archive`, `public.zip-archive`, `public.data` (spike 01). (tinyjs has no config key for this — see §9.3.) | P0 |
| D3 | Accept folders. Upload the folder contents recursively and keep the relative paths. Ask for confirmation when a folder has more than 500 files or more than 5 GB. | P1 |
| D4 | Accept files dropped on the dashboard window (`tiny.win.onDrop`) and from a "Choose files…" button (`dialog.openFiles`). | P0 |
| D5 | Launched with files → do not show the dashboard. Show only the progress window (or no window, if the user turned it off). | P0 |
| D6 | Launched with no files, or Dock icon clicked when the app is idle → show the dashboard. | P0 |
| D7 | Modifier keys at drop time: ⌥ = show the destination picker; ⇧ = send to all "secondary" destinations. | P1 |
| D8 | Dock menu (right-click the Dock icon): list of destinations, "Upload to… ▸", "Pause all", "Resume all", "Open dashboard". Moved to P2: tinyjs 0.41.1 has no Dock menu API (spike 01). | P2 |

**Launch detection (D5/D6).** tinyjs gives no "launched with files" flag. The host starts with the main window hidden. If `onOpenFiles` does not fire within 400 ms after `init(app)`, the host shows the dashboard. Milestone 0 must test this and the Dock-click behavior (see §12).

### 7.2 Destinations and routing

| ID | Requirement | Pri |
|---|---|---|
| R1 | The user can add, edit, test, and remove destinations. "Test" does a small PUT + DELETE (S3/R2) or `about.get` (Drive). | P0 |
| R2 | One destination is the default destination. | P0 |
| R3 | A file can go to more than one destination in the same batch ("fan-out"). | P0 |
| R4 | Rules by file type, size, and name pattern. Example: images → R2 public; files > 1 GB → S3; `.docx/.pdf` → Drive. First match wins; the default destination is the fallback. | P1 |
| R5 | Path template for each destination: `{yyyy} {mm} {dd} {name} {ext} {hash8} {uuid}`. Default: `{yyyy}/{mm}/{name}-{hash8}.{ext}`. | P0 |
| R6 | Link type for each destination: public base URL / custom domain, presigned URL (1 h, 1 d, 7 d), or Drive web link. | P0 |

### 7.3 Upload engine

| ID | Requirement | Pri |
|---|---|---|
| U1 | S3 and R2: use `aws-sdk-go-v2` `service/s3`, with our own multipart on `CreateMultipartUpload` / `UploadPart` / `CompleteMultipartUpload` that streams each Part from the file (ADR 0002). Single PUT below 16 MiB, multipart above. Part size = `max(8 MiB, ceil(size / 10000))`. | P0 |
| U2 | R2 specifics: endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, region `auto`, all parts except the last must be the same size, checksum mode `WHEN_REQUIRED` if R2 refuses the SDK default. | P0 |
| U3 | Google Drive: resumable upload (`uploadType=resumable`) with `google.golang.org/api/drive/v3`. Chunk size 16 MiB (a multiple of 256 KiB). On failure, query the offset with `Content-Range: bytes */TOTAL` and continue. On 404, start a new session. | P0 |
| U4 | Concurrency: max 3 files at the same time, max 4 parts per file (configurable). | P0 |
| U5 | Retry with exponential backoff and full jitter (base 0.5 s, max 30 s, 8 tries) for 5xx, 429, S3 `SlowDown`/`RequestTimeout`, Drive `rateLimitExceeded`/`userRateLimitExceeded`. Do not retry other 4xx errors. | P0 |
| U6 | Resume: save upload state (upload ID / session URI, completed parts) in SQLite. After a crash, restart, or network loss, continue from the last completed part. | P0 |
| U7 | Pause, resume, and cancel for each upload and for all. Cancel calls `AbortMultipartUpload` (S3/R2). | P0 |
| U8 | Network loss: pause the queue when the network is gone. Continue automatically when it returns. | P0 |
| U9 | Duplicate detection: compute a content hash (BLAKE3 in the engine). If the same hash was uploaded to the same destination and the object still exists (HEAD), give the old link and mark the upload "skipped — duplicate". | P1 |
| U10 | Integrity: use the SDK default checksums (CRC32 / CRC64NVME). Record the ETag and checksum for each upload. | P0 |
| U11 | Clean-up: the dashboard lists incomplete multipart uploads older than 24 h and offers "Abort all". Recommend a bucket lifecycle rule `AbortIncompleteMultipartUpload` in the destination setup. | P1 |

### 7.4 Progress and feedback

| ID | Requirement | Pri |
|---|---|---|
| P1 | Dock icon: `app.progress(0..1)` for the full queue; `app.badge(n)` for files that remain; clear both when done. | P0 |
| P2 | Progress window (small, frameless, near the Dock or top-right): one row per upload with name, destination icon, bytes/total, speed, ETA, and state. Pause / cancel / retry buttons. | P0 |
| P3 | Byte-level progress: the engine counts bytes as they go on the wire. It shows `max(committed, in-flight)` so progress does not go backwards when a part retries. | P0 |
| P4 | Progress events: the engine sends events at most every 100 ms per upload. The host batches them and sends them to the windows with `app.push('progress', …)`. | P0 |
| P5 | Notification when a batch is done: "12 files uploaded · 84 MB · 6.2 s", with actions "Copy links", "Open", "Show in dashboard" (`app.notify` + `onNotificationAction`). | P0 |
| P6 | Copy to clipboard when done: one file → its link; more files → one link per line. Options: plain, Markdown, HTML. | P0 |
| P7 | Menu-bar item (tray) with the queue and progress. Off by default. | P2 |

### 7.5 Error handling

| ID | Requirement | Pri |
|---|---|---|
| E1 | Map errors to user messages and one clear action. | P0 |
| E2 | A failed upload stays in the queue as "Failed" with "Retry" and "Copy error details". | P0 |
| E3 | One notification for each batch with failures (not one for each file). | P0 |
| E4 | Before the upload starts, check that each file can be read and that the destination has valid credentials. Fail fast with a clear message. | P0 |
| E5 | If the Mac goes to sleep, pause the queue and continue on wake. | P1 |

| Error | Message | Action |
|---|---|---|
| S3 `ExpiredToken` (SSO) | "Your AWS sign-in expired." | "Sign in again" (runs `aws sso login --profile X`) |
| `InvalidAccessKeyId`, `SignatureDoesNotMatch` | "The access keys for {account} are not correct." | "Edit account" |
| `RequestTimeTooSkewed` | "Your Mac clock is not correct." | "Open Date & Time settings" |
| `AccessDenied` 403 | "{account} cannot write to {bucket}." | "Show required IAM policy" |
| `NoSuchBucket` | "The bucket {bucket} does not exist." | "Edit destination" |
| Drive 401 (refresh fails) | "Google Drive disconnected." | "Connect again" |
| Drive `storageQuotaExceeded` | "Your Google Drive is full." | "Open Drive storage" |
| Network gone | "Waiting for network…" | automatic |
| File changed during upload | "{file} changed during upload." | "Upload again" |

### 7.6 Accounts and security

| ID | Requirement | Pri |
|---|---|---|
| A1 | All secrets go in the macOS Keychain with `app.secrets` (one item per account). Never in plain files, logs, argv, or environment variables. | P0 |
| A2 | S3: support access keys, and named profiles from `~/.aws/config` including SSO (IAM Identity Center). Show the minimum IAM policy: `s3:PutObject`, `s3:DeleteObject` (the Test object, and delete from history), `s3:AbortMultipartUpload`, `s3:ListBucket`, `s3:ListMultipartUploadParts`, `s3:GetObject` (presign/HEAD), `cloudwatch:GetMetricData` (dashboard). | P0 |
| A3 | R2: S3-compatible API token + account ID. Optional second Cloudflare API token with **Account Analytics: Read** for dashboard metrics. | P0 |
| A4 | Google Drive: OAuth 2.0 "Desktop app" client, loopback redirect `http://127.0.0.1:<random port>`, PKCE S256. Scope `drive.file` only (non-sensitive; no CASA assessment). Publish the OAuth app to "In production" (in "Testing", refresh tokens expire after 7 days). | P0 |
| A5 | The host reads secrets from the Keychain and gives them to the engine over the private socket, only when the engine needs them. | P0 |
| A6 | The dashboard page never gets secret values. It sees only account names and status. | P0 |

### 7.7 Dashboard

The dashboard is one window with a left navigation: **Overview**, **Uploads**, **Network**, **Storage & cost**, **Destinations**, **Settings**.

| ID | Widget | Data source | Chart | Pri |
|---|---|---|---|---|
| W1 | "Nerd strip": bytes today, uploads today, success rate, average speed, concurrency, network interface | local DB | stat tiles | P0 |
| W2 | Live throughput (rolling 60 s, one line per provider) | engine events | uPlot sparkline | P0 |
| W3 | Recent uploads table: thumbnail, name, size, destination, duration, average speed, mini speed sparkline, link actions (copy, open, presign again, delete) | local DB | table + uPlot | P0 |
| W4 | Queue panel: active, paused, failed, offline | engine | list | P0 |
| W5 | Per-part waterfall for one upload (start → end for each part, color by retry count) | local DB | ECharts custom series | P1 |
| W6 | Latency histogram + p50/p95/p99 per provider (time per part, time to first byte) | local DB | ECharts histogram / box plot | P1 |
| W7 | Upload calendar heatmap (12 months, count or bytes per day) | local DB | ECharts calendar | P1 |
| W8 | Throughput heatmap by weekday × hour | local DB | ECharts heatmap | P1 |
| W9 | Success/error rate per hour + error code breakdown | local DB | ECharts stacked bar | P0 |
| W10 | Storage by file type (drill down to extension) | local DB | ECharts treemap / sunburst | P1 |
| W11 | Flow: file type → provider → bucket, sized by bytes | local DB | ECharts sankey | P2 |
| W12 | Bucket / account storage over time + quota projection | S3 CloudWatch `BucketSizeBytes`/`NumberOfObjects` (daily); R2 GraphQL `r2StorageAdaptiveGroups`; Drive `about.get` `storageQuota` | ECharts area | P1 |
| W13 | Request counts (R2 Class A/B from `r2OperationsAdaptiveGroups`; S3 from local counts) | provider APIs + local DB | ECharts bar | P1 |
| W14 | Estimated monthly cost per provider + free-tier gauge | computed from W12/W13 and a price table | ECharts gauge + table | P1 |
| W15 | Incomplete multipart uploads (waste) + "Abort all" | `ListMultipartUploads` | table | P1 |

Dashboard rules:
- Charts must work in light and dark mode and follow the system setting.
- Provider metrics are cached in SQLite. Refresh them every 15 minutes when the dashboard is open, and on demand.
- Show the age of each metric ("CloudWatch data: 1 day old").
- Price table (Sept 2026, us-east-1 / list): S3 Standard $0.023/GB-month, PUT $0.005/1k, GET $0.0004/1k, egress $0.09/GB after 100 GB; R2 Standard $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, egress free, free tier 10 GB + 1M A + 10M B. Keep prices in a JSON file that the app can update.

### 7.8 Settings

- Launch at login (`app.launchAtLogin`) — P1
- Show progress window on drop (on/off) — P0
- Clipboard format (plain / Markdown / HTML) — P0
- Concurrency limits — P1
- Notifications (all / failures only / none) — P0
- History retention (default 180 days) — P1
- Auto-update channel (`update.auto: 'daily'`) — P0

## 8. Non-functional requirements

| Area | Target |
|---|---|
| Size | .app less than 30 MB (tinyjs ~6 MB + Go engine ~12–18 MB stripped + frontend ~1–2 MB) |
| Start | Progress window visible less than 500 ms after a drop on cold launch |
| Throughput | At least 90% of `aws s3 cp` speed on the same network for a 1 GB file |
| Memory | Host + engine less than 150 MB RSS during 10 parallel uploads; the engine streams from disk and never loads a full file into memory |
| Reliability | 0 corrupt objects (checksums); a killed app resumes every multipart upload |
| Security | Secrets only in Keychain; engine socket in a private temp dir with mode 0600; hardened runtime; notarized |
| Accessibility | All controls work with the keyboard and VoiceOver; charts have a table view |
| Privacy | No telemetry. All statistics stay on the Mac. |

## 9. Architecture

```
 Finder / Dock drop
        │  application:openFiles
        ▼
┌──────────────────────────── Droplift.app ────────────────────────────┐
│                                                                      │
│  tinyjs launcher (WebKit windows)                                     │
│   ├─ window "main"      → Dashboard (Next.js static export)           │
│   └─ window "progress"  → Progress UI (same build, /progress route)   │
│            ▲  tiny.api.call(...)        ▲  tiny.api.on('progress')    │
│            │                            │                             │
│  Host (txiki.js backend: backend/main.ts)                             │
│   - onOpenFiles → routing rules → enqueue                             │
│   - Dock progress/badge, notifications, clipboard, Keychain           │
│   - SQLite (tjs:sqlite): destinations, uploads, parts, metrics        │
│   - starts + supervises the engine                                    │
│            │  JSON-RPC over Unix socket (private temp dir)            │
│            ▼                                                          │
│  Engine (Go sidecar: Contents/MacOS/droplift-engine)                  │
│   - S3/R2 transfermanager, Drive resumable, retries, hashing          │
│   - byte progress events, network monitor, provider metrics calls     │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.1 Host (tinyjs backend, TypeScript)
- Owns the app life cycle, windows, Dock, notifications, Keychain, SQLite, and routing rules.
- Exposes an API to the pages: `export const api = { listUploads, pause, resume, retry, cancel, addDestination, testDestination, getMetrics, … }`.
- Pushes events to the pages: `progress`, `upload-state`, `batch-done`, `metrics-updated`.
- Keeps the upload queue in the host and engine, not in the page (hidden windows are throttled).

### 9.2 Engine (Go)
- One static binary, built with `-ldflags "-s -w"`, universal (arm64 + amd64).
- **IPC: JSON-RPC 2.0 over a Unix domain socket.** Do not use stdin: tinyjs 0.41.1 has a bug where only the first write to a child's stdin arrives (upstream txiki.js PR #1028). The host creates the socket with `tjs.listen('pipe', path)` and starts the engine with `app.spawnHidden(enginePath, ['--socket', path])`. The engine connects to it.
- Methods: `upload.enqueue`, `upload.pause`, `upload.resume`, `upload.cancel`, `dest.test`, `metrics.fetch`, `multipart.listIncomplete`, `multipart.abort`, `auth.gdrive.start`.
- Events (engine → host): `progress {id, sent, total, bps, part}`, `part.done`, `upload.done {id, etag, checksum, link}`, `upload.failed {id, code, message, retryable}`, `net.state`, `secret.request {account}`.
- The engine asks for secrets with `secret.request`. The host answers from the Keychain. The engine keeps them in memory only.
- If the engine exits, the host starts it again (max 3 times per minute) and resumes the queue from SQLite.
- Google OAuth: the engine runs the loopback listener; the host opens the browser URL.

### 9.3 Build and release
tinyjs has no config for an extra binary or for custom UTIs, and `copyTree` drops the exec bit. So the release needs a custom script:

1. `vite build` → `frontend/dist` (ADR 0001).
2. `GOOS=darwin` build for arm64 + amd64 → `lipo` → `droplift-engine`.
3. `tinyjs build`.
4. Copy `droplift-engine` into `Droplift.app/Contents/MacOS/` and `chmod +x`.
5. Patch `Info.plist` (`tinyjs build` rewrites it, so patch after every build): `CFBundleDocumentTypes` with two types, both role `Viewer`, rank `Alternate`: (1) `[public.item, public.folder]`, (2) the specific UTIs from D2 so the app shows in Finder's Open With list; and `TinyjsActivation = accessory` (no `LSUIElement`) so the window stays hidden at launch (spike 01).
6. `codesign --options runtime --timestamp` the engine, then the .app.
7. `tinyjs notarize --dmg` (only with a Developer ID). Without one, sign with the self-signed development certificate (or ad-hoc) and skip notarization; other Macs then need "Open Anyway" in Privacy & Security.
8. Zip the stapled .app, compute sha256, write the auto-update manifest (`tinyjs publish` does not notarize, so do not use it for the final release).

The host finds the engine at runtime next to `tjs.exePath`.

### 9.4 Dashboard frontend: Next.js
You asked for the latest Next.js if possible. The current stable release is **Next.js 16.3.x** (Active LTS). It is possible, with these limits:

- Use `output: 'export'`, `trailingSlash: true`, `images: { unoptimized: true }`.
- Only static features: Client Components, client-side data from `tiny.api.call`, `next/link`. No Server Actions, Route Handlers with request data, middleware/proxy, ISR, or dynamic routes without `generateStaticParams`.
- Every use of `window` or `tiny` goes in `useEffect` or a client-only component, because Next prerenders pages at build time.
- **Problem:** the built app loads pages from `file://`, and Next.js writes absolute `/_next/...` asset paths, which break under `file://`.

**Decision (M0, spike 03): Vite + React.** See `docs/adr/0001-dashboard-frontend-vite-react.md`. Both Next options below passed, but A is fragile and B adds a local port. The rest of this section is kept as history.

Two ways to solve it (Milestone 0 picks one):

| Option | How | Trade-off |
|---|---|---|
| **A. One-route SPA + path rewrite** | One `app/page.tsx`; views switch with client state or `#hash`. A post-build step rewrites `/_next/` to `./_next/`. | No local port. Loses Next routing. Rewrite step can break on Next upgrades. |
| **B. Loopback server** | The host serves `frontend/dist` with `tjs.serve` on `127.0.0.1:<random port>`; windows load that URL. Limit the `tiny` bridge with `"api": { "origins": [...] }`. | Full Next routing works. Adds a local port, which tinyjs normally avoids; must bind to loopback only. |

**Fallback:** if both options fail the Milestone 0 test, use Vite + React (`tinyjs new --template react-ts`), which is the path tinyjs documents. The research agents recommend Vite for this app because the dashboard does not use any Next.js server features. The React components and chart code are the same in both, so the switch costs little.

### 9.5 Charts
- **Apache ECharts 6** (Apache-2.0), tree-shaken (measured in spike 03: ~180 KB gzip for core + one line chart; import ECharts through one module only, or chunks duplicate it): heatmap, calendar, treemap, sunburst, sankey, gauge, custom waterfall. Canvas renderer.
- **uPlot** (MIT, ~20 KB gzip): live throughput and latency time series. Very low CPU and memory.
- Do not use Recharts, Tremor, or shadcn charts: they are SVG-based, slow with streaming data, and have no calendar or heatmap.

### 9.6 Data model (SQLite, `tjs:sqlite`)

```
accounts(id, provider, name, keychain_ref, meta_json, created_at)
destinations(id, account_id, name, bucket, prefix_template, link_type, link_ttl, public_base_url, is_default, secondary)
rules(id, position, match_json, destination_ids_json)
batches(id, created_at, source, file_count, total_bytes)
uploads(id, batch_id, destination_id, path, size, hash, key, state, upload_id, session_uri,
        bytes_sent, started_at, finished_at, avg_bps, peak_bps, retries, error_code, error_msg, etag, checksum, link)
parts(upload_id, n, size, started_at, finished_at, retries, bps)
metrics(provider, account_id, bucket, metric, ts, value, fetched_at)
```

## 10. UX flows

### 10.1 First launch
1. The dashboard opens with an empty state: "Connect your first destination".
2. The user picks S3, R2, or Google Drive.
3. S3/R2: form with keys (or AWS profile list) + bucket + optional public URL. "Test" must pass before "Save".
4. Drive: "Sign in with Google" → browser → back to the app → pick or create a folder.
5. The first destination becomes the default destination.
6. A short tip: "Drag files onto the Droplift icon in your Dock to upload."

### 10.2 Drop with no modifier
1. Files arrive → rules select destinations → uploads go to the queue.
2. The Dock shows progress and the badge. The progress window shows the rows (if turned on).
3. When done: links go to the clipboard, one notification, the progress window closes after 3 s (if there are no errors).

### 10.3 Drop with ⌥
A small picker window shows the destinations as checkboxes (last choice is remembered). Enter = upload, Esc = cancel.

### 10.4 Failure
The row goes red with a short message and "Retry". The Dock badge shows "!" when the queue is empty but has failures. One notification per batch.

## 11. Success metrics (local only)
- 95% or more of uploads succeed without the user doing anything.
- Median time from drop to link in the clipboard, for a 5 MB file on a 100 Mbit/s uplink: less than 2 s.
- Zero lost uploads after a crash or network loss (all resume).

## 12. Milestones

| # | Scope | Exit criteria |
|---|---|---|
| **M0 — Spikes (1 week)** | (a) Dock drop cold/warm + launch detection timer + Dock click when idle; (b) `public.item` Info.plist patch; (c) Go engine in `Contents/MacOS`, signed + notarized, talks over Unix socket; (d) Next.js static export under Option A and Option B | Each spike has a pass/fail note. Frontend decision made (A, B, or Vite). |
| **M1 — Core upload** | One S3/R2 destination, drop → upload → link → clipboard, Dock progress, notification, basic progress window | Story 1, 3, 5 work |
| **M2 — Reliability** | Multipart resume in SQLite, retries, pause/resume/cancel, network loss, error map | Story 4 works; kill-test passes |
| **M3 — Drive + routing** | Google OAuth, Drive resumable, multiple destinations, fan-out, rules, ⌥ picker, Dock menu | Story 2, 9 work |
| **M4 — Dashboard** | W1–W4, W9 (P0), then P1 widgets, provider metrics, cost | Story 6, 7, 8 work |
| **M5 — Release** | Duplicate detection, settings, launch at login, release script, auto-update, notarized DMG | Signed DMG installs and updates on a clean Mac |

## 13. Risks and open questions

| Risk / question | Impact | Mitigation |
|---|---|---|
| No "launched with files" flag in tinyjs | Dashboard can flash, or not show | 400 ms timer + `TinyjsActivation = accessory` patch (spike 01: pass). tinyjs sends its own `entry.js` to `onOpenFiles` on every launch; ignore paths inside the bundle. Ask tinyjs maintainer for a `launchedWithFiles` flag. |
| No Dock-click (reopen) event in tinyjs (confirmed, spike 01) | Clicking the Dock icon does not open the dashboard when the app is already running | "Park" workaround (`show({activate:false})` + `hide()` in one tick): a Dock click then works, but the park makes a visible window flicker (spike 01, human check). Park only when a window is already on screen (ticket 21). No Dock menu API either, so no Dock-menu fallback. Request `onReopen` and a Dock menu API upstream. |
| No config for UTIs or extra binaries | Custom build script needed | §9.3 script; propose `extraBinaries` and `documentTypes` keys upstream. |
| txiki.js child stdin bug | Engine IPC breaks if stdin is used | Unix socket IPC (§9.2). |
| Next.js under `file://` | Broken assets / routing | Option A or B, fallback Vite (§9.4). |
| "Accessory" mode (no Dock icon) | Cannot drop on the Dock | Use normal activation. The app must keep its Dock icon. |
| Google OAuth verification | Delay before public release | `drive.file` scope only (no restricted-scope review). |
| R2 "same part size" and "part overwrite loses the old part" rules | Corrupt or failed uploads on retry | Fixed part size; never re-upload a completed part number. |
| S3 CloudWatch request metrics cost money | Unexpected bill | Off by default; use free daily storage metrics + local counts. |
| Windows/Linux support is beta in tinyjs | Not in v1 | macOS only in v1. |

## 14. Future (P2+)
- Dock menu (D8), when tinyjs has a Dock menu API.
- Menu-bar mode with a popover-style window.
- More providers: Backblaze B2, Wasabi, MinIO (S3-compatible, cheap to add), Dropbox, OneDrive.
- Image processing before upload (strip EXIF, resize, convert to WebP/AVIF).
- Link expiry + delete from history.
- Shortcuts / AppleScript actions ("Upload file to destination").
- Share extension (Finder "Share → Droplift").
- Windows and Linux builds when tinyjs support is stable.

## 15. References
- tinyjs docs: https://tinyjs.app/docs.html · changelog: https://tinyjs.app/changelog.html · local `~/.tinyjs/README.md`, `skill/references/api.md`, `recipes.md`, `performance.md`
- S3 limits: https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html
- S3 checksums: https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html
- Go transfermanager: https://pkg.go.dev/github.com/aws/aws-sdk-go-v2/feature/s3/transfermanager
- R2 S3 API: https://developers.cloudflare.com/r2/api/s3/api/ · multipart: https://developers.cloudflare.com/r2/objects/multipart-objects/ · limits: https://developers.cloudflare.com/r2/platform/limits/ · metrics: https://developers.cloudflare.com/r2/platform/metrics-analytics/ · pricing: https://developers.cloudflare.com/r2/pricing/
- Drive uploads: https://developers.google.com/workspace/drive/api/guides/manage-uploads · errors: https://developers.google.com/workspace/drive/api/guides/handle-errors · OAuth native apps: https://developers.google.com/identity/protocols/oauth2/native-app
- S3 CloudWatch metrics: https://docs.aws.amazon.com/AmazonS3/latest/userguide/cloudwatch-monitoring.html · pricing: https://aws.amazon.com/s3/pricing/
- Next.js static export: https://nextjs.org/docs/app/guides/static-exports
- uPlot: https://github.com/leeoniya/uPlot
- Comparable apps: Dropover (https://dropoverapp.com), Dropshare (https://dropshare.app), Dropzone, Transmit, Cyberduck, R2Drop (https://r2drop.com)
