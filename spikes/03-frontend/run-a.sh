#!/bin/sh
# PROTOTYPE — Option A: Next export + path rewrite, loaded from file:// in a BUILT tinyjs app.
set -e
cd "$(dirname "$0")"
(cd web && pnpm install --silent && pnpm build >/dev/null)
rm -rf app-a/fe && cp -R web/out app-a/fe && node rewrite-a.mjs app-a/fe
(cd app-a && tinyjs build >/dev/null)
rm -f /tmp/spike03-a.log
SPIKE_QUIT_MS=${SPIKE_QUIT_MS:-12000} app-a/dist/Spike\ 03\ A.app/Contents/MacOS/* || true
echo "--- /tmp/spike03-a.log"; cat /tmp/spike03-a.log
