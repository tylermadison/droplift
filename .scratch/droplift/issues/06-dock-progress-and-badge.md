# 06: Dock progress and badge

**What to build:** During a Batch, the Dock icon shows the progress of the full Queue and a badge with the number of files that remain. Both clear when done. The Engine counts bytes on the wire and sends progress events at most every 100 ms per Upload. The Host batches them and pushes them to open windows (PRD story 3, P1, P3, P4).

**Blocked by:** 05 (Drop → upload → link on the clipboard)

**Status:** ready-for-agent

- [ ] Dock progress goes from 0 to 1 over the full Queue and clears when done
- [ ] Dock badge shows files that remain and clears when done
- [ ] Engine sends at most one progress event per Upload every 100 ms
- [ ] Host batches events and pushes `progress` to windows
- [ ] Shown progress is `max(committed, in-flight)` and never goes backwards
