# 23: Folder drops

**What to build:** The user can drop a folder. The app uploads its contents recursively and keeps the relative paths. It asks for confirmation when the folder has more than 500 files or more than 5 GB (PRD D3).

**Blocked by:** 22 (Window drop and "Choose files…")

**Status:** ready-for-agent

- [ ] A dropped folder uploads all files recursively
- [ ] Keys keep the relative paths under the folder
- [ ] Confirmation shows above 500 files or 5 GB; cancel starts no Upload
- [ ] Works from the Dock icon and from the dashboard window
