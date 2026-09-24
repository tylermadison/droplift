# 19: ⌥ picker and ⇧ secondary destinations

**What to build:** When the user holds ⌥ during a Drop, a small picker window shows the Destinations as checkboxes (last choice is remembered). Enter = upload, Esc = cancel. When the user holds ⇧, the files go to all "secondary" Destinations (PRD story 2, D7, §10.3).

**Blocked by:** 17 (Many destinations and fan-out)

**Status:** ready-for-agent

- [ ] ⌥ at drop time shows the picker; no Upload starts before the user confirms
- [ ] Picker remembers the last choice
- [ ] Enter uploads; Esc cancels the Drop
- [ ] ⇧ at drop time sends files to all secondary Destinations
- [ ] Picker works with the keyboard and VoiceOver
- [ ] If modifier detection at drop time is not possible, the ticket records the limit and the fallback
