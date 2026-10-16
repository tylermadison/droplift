## Agent skills

### Issue tracker

Issues are local markdown files under `.scratch/<feature-slug>/`, committed with the repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, each label equal to its name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Engineering brain

This repo is `repo/droplift` in Tyler's engineering knowledge graph, served by the `brain` MCP server (`brain_recall`, `brain_ingest`). When it's connected:

- Before changing schema, auth, data flow, deploy setup or dependencies, call `brain_recall` with `droplift <topic>` and cite the slugs you rely on (e.g. `adr/droplift-…`).
- After a decision (with the options rejected), an incident fix or a new procedure, record it with `brain_ingest` (its description has the format) and link it with `affects:: [[repo/droplift]]`. Record only what was decided, never secrets or env values.
- If the brain and the code disagree, trust the code, say so, and update the brain.

If the server isn't connected, skip this and carry on.
