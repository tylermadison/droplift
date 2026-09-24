# 18: Rules

**What to build:** The user makes Rules that select Destinations by file type, size, and name pattern. Example: images → R2 public; files > 1 GB → S3; `.docx/.pdf` → Drive. The first match wins; the default destination is the fallback (PRD R4).

**Blocked by:** 17 (Many destinations and fan-out)

**Status:** ready-for-agent

- [ ] User can add, edit, reorder, and remove Rules
- [ ] A Rule matches on file type, size, and/or name pattern and selects one or more Destinations
- [ ] First match wins; no match → default destination
- [ ] Tests cover rule matching and ordering
