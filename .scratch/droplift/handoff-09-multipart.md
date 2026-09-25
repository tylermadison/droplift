# Handoff: TDD on ticket 09 (multipart upload)

Written 2026-09-24 at `main` = `0788434`. The next session implements **ticket 09** with the `tdd` skill:
`.scratch/droplift/issues/09-multipart-upload-for-large-files.md`.

## Read first

- `CLAUDE.md` → `docs/agents/issue-tracker.md` (local tickets in `.scratch/droplift/issues/`), `triage-labels.md`, `domain.md`.
- `docs/prd.md`: §4 glossary (use these words), U1, U2, U4, U10, §8 (throughput, memory), §9.2 (Engine), §9.6 (`parts` table).
- `docs/adr/0001-dashboard-frontend-vite-react.md`.
- Tickets 04–08 (all `resolved`): the "Comments" sections record decisions, measurements, and platform findings.
- There is no `CONTEXT.md` yet. The PRD glossary is the vocabulary.

## State

- M0 and M1 are done: tickets 01–08 `resolved`, 20 `wontfix` (no tinyjs Dock menu API). M2 starts with 09.
- Code: `app/backend/` (Host, TypeScript on txiki.js), `app/src/` (Vite + React pages: setup screen, `progress.html`), `engine/` (Go), `scripts/dev-build.sh`.
- Spike code (throwaway) is on branch `spike/m0` (pushed) and in the worktree `../droplift-spikes`.

## How to work here

- **Tests:** `cd app && npx vitest run` (projects `host` = Node + `node:sqlite`, `page` = jsdom). `cd engine && go test ./...`.
- **Types:** `cd app && npx tsc -b && npx tsc -p backend --noEmit`.
- **Build and run:** `scripts/dev-build.sh`, then `open -a /Users/…/droplift/app/dist/Droplift.app <file>` (`open -a` needs an **absolute** path; it sends the same open-files event as a Dock drop).
- **Test seams already in place** (reuse them; do not mock own modules):
  - Engine: `engine/dest_test.go` has a test Host over `net.Pipe` (`startEngine`, `startEngineWith`, `host.call`, `host.keys`, `host.onNotify`) and `fakeS3` (an `http.RoundTripper` that records requests and bodies). `engine/progress_test.go` has `fakeClock` and `slowS3`. `engine/upload_test.go` has `writeFile`, `r2Upload`, `enqueue`, `fixedNow`.
  - Host: `app/backend/test-fakes.ts` (`memoryDb`, `memorySecrets`); `uploads.test.ts` `setup()` with a fake Engine, clipboard, queue, notifier, clock.
  - Page: Testing Library with fake sources (`src/setup/SetupScreen.test.tsx`, `src/progress/ProgressWindow.test.tsx`).
- **Seams first:** agree the seams with the user (AskUserQuestion) before the first test. Red before green, one slice at a time. Say so when a test passes at once.

## Ticket 09: facts from the code that matter

- The single PUT is in `engine/upload.go` (`upload`): BLAKE3 hash pass, rewind, `countingReader` (`engine/progress.go`) as the body, `PutObject`, then the Link. The 16 MiB switch goes here.
- PRD U1 names `aws-sdk-go-v2` `feature/s3/transfermanager`. Check that the module exists at the pinned SDK version before you design around it. Its part size and R2 "same part size" rule (U2) must be under our control.
- **Progress with parts:** `countingReader` counts one stream, and a `Seek` moves the count back. With parallel Parts, progress must be the sum over Parts, and the Host queue (`app/backend/queue.ts`) already keeps the shown value from going back (P3).
- **Parts in SQLite:** the acceptance criterion needs a `parts` row per Part (size, start, end, retries, speed). There is no `parts` table yet. The Engine has only `progress` notifications, so a Part event to the Host is new. PRD §9.2 lists `part.done`.
- **Concurrency (U4):** `uploads.drop` (`app/backend/uploads.ts`) starts every file at once (`Promise.allSettled`). There is no 3-files limit yet. Decide with the user whether it goes in the Host or the Engine.
- **Checksums (U10):** the single PUT records the CRC64NVME checksum that R2 returns. For multipart, check what R2 accepts (U2: `WHEN_REQUIRED` fallback).
- **Schema changes:** existing development databases need `ALTER TABLE` for new columns (see `PRAGMA table_info` checks in `destinations.ts` and `uploads.ts`).
- **Measurements the ticket asks for:** 1 GB throughput vs `aws s3 cp` (check that the AWS CLI is installed and configured for R2), and Host + Engine < 150 MB RSS during 10 parallel Uploads. The Engine RSS for a 100 MB single PUT was 23 MB (ticket 05).

## Environment facts

- **Real bucket:** the user's R2 test bucket `droplift-test` is the only Destination (presigned Links, 1 h). The keys are in the Keychain, never in files. It already holds test objects under `2026/09/`.
- **Keychain dialog after every rebuild:** the self-signed "Droplift Dev" certificate has no Team ID, so macOS asks again after each build. The user must click "Always Allow"; until then the upload waits, and the launcher shows no new windows. Plan manual checks in few builds (ticket 04 correction).
- **Dock badge:** hidden by macOS for `app.droplift` on this Mac; the code is proven with another bundle ID (ticket 06). Do not debug it again in ticket 09.
- **No Screen Recording permission** for the terminal: ask the user for screenshots. Window checks work with `CGWindowListCopyWindowInfo` (owner name `Droplift`, capital D); Dock state with the `AXStatusLabel` of the Dock item.
- `app/.agents/` and `app/.claude/` (tinyjs template skill copies) are untracked on purpose, until the user decides.

## User preferences

- Talk in ASD-STE100 Simplified Technical English.
- One branch per ticket (`ticket-09-…`). Commit on the branch; merge (fast-forward) into `main` and push **only when the user asks**.
- The user does the manual checks (Keychain, visual checks). Give short numbered steps and say what they must see.
- Record results, measurements, and platform findings as a dated comment on the ticket; tick only the criteria that were shown.

## Open items (not for ticket 09 unless the user asks)

- VoiceOver check by hand of the progress window (ticket 08).
- Delete merged local branches `ticket-04` … `ticket-08`?
- Commit or delete `app/.agents/` and `app/.claude/`?

## Suggested skills

- `tdd`: the loop for ticket 09.
- `tinyjs` (in `app/.claude/skills/tinyjs`): Host APIs (`app.*`, `tjs.*`).
- `diagnosing-bugs`: if a real-bucket run fails in a way the tests do not show.
- `code-review`: after ticket 09, before the merge.
