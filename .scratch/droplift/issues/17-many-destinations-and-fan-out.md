# 17: Many destinations and fan-out

**What to build:** The user can add, edit, and remove more Destinations and select which one is the default destination. One file can go to more than one Destination in the same Batch: one file sent to 2 Destinations = 2 Uploads (PRD R1–R3).

**Blocked by:** 05 (Drop → upload → link on the clipboard)

**Status:** ready-for-agent

- [ ] User can add, edit, test, and remove Destinations
- [ ] Exactly one Destination is the default destination; the user can change it
- [ ] A file sent to N Destinations makes N Uploads in the same Batch
- [ ] Clipboard and notification include the Links from all Uploads
- [ ] A Destination can be marked "secondary"
