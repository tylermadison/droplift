# 15: Connect Google Drive

**What to build:** The user clicks "Sign in with Google". The browser opens, the user signs in, and returns to the app. The Engine runs the loopback listener on `127.0.0.1:<random port>` with PKCE S256 and scope `drive.file` only. The user then selects or creates a folder. "Test" calls `about.get`. The token goes to the Keychain (PRD story 9, §10.1, A4, R1).

**Blocked by:** 04 (Connect the first S3/R2 destination)

**Status:** ready-for-agent

- [ ] Sign-in works through the system browser; the user never pastes a token
- [ ] Loopback redirect binds to 127.0.0.1 on a random port, with PKCE S256
- [ ] Only the `drive.file` scope is requested
- [ ] User can select or create a folder for the Destination
- [ ] "Test" calls `about.get` and must pass before "Save"
- [ ] Refresh token is in the Keychain only; a failed refresh shows "Google Drive disconnected." with "Connect again"
