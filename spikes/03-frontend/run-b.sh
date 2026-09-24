#!/bin/sh
# PROTOTYPE — Option B: Next export served by the host on 127.0.0.1:<random>, BUILT tinyjs app.
set -e
cd "$(dirname "$0")"
(cd web && pnpm install --silent && pnpm build >/dev/null)
rm -rf app-b/fe && mkdir -p app-b/fe && cp app-b-bootstrap.html app-b/fe/index.html && cp -R web/out app-b/fe/site
(cd app-b && tinyjs build >/dev/null)
rm -f /tmp/spike03-b.log
SPIKE_QUIT_MS=${SPIKE_QUIT_MS:-12000} app-b/dist/Spike\ 03\ B.app/Contents/MacOS/* &
PID=$!
sleep 4; echo "--- listening sockets of the app:"; lsof -nP -iTCP -sTCP:LISTEN -a -p "$(pgrep -f 'Spike 03 B.app' | tr '\n' ',' | sed 's/,$//')" || true
wait $PID || true
echo "--- /tmp/spike03-b.log"; cat /tmp/spike03-b.log
