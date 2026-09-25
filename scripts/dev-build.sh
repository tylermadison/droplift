#!/bin/sh
# Development build: engine + tinyjs app, engine copied into the bundle, signed with
# "Droplift Dev" when that certificate exists (else ad-hoc). The release script is ticket 34.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="${TINYJS_SIGN_IDENTITY:-}"
if [ -z "$ID" ] && security find-identity -v -p codesigning | grep -q '"Droplift Dev"'; then ID="Droplift Dev"; fi
ID="${ID:--}"

(cd "$ROOT/engine" && go build -o "$ROOT/engine/bin/droplift-engine" ./cmd/droplift-engine)
(cd "$ROOT/app" && tinyjs build >/dev/null)

APP="$(ls -d "$ROOT"/app/dist/*.app | head -1)"
cp "$ROOT/engine/bin/droplift-engine" "$APP/Contents/MacOS/droplift-engine"
chmod +x "$APP/Contents/MacOS/droplift-engine"
for f in "$APP/Contents/MacOS/droplift-engine" "$APP"/Contents/MacOS/*; do
  codesign --force --options runtime --timestamp=none -s "$ID" "$f" 2>/dev/null || true
done
codesign --force --options runtime --timestamp=none -s "$ID" "$APP"
codesign --verify --strict "$APP"
echo "built: $APP (signed with: $ID)"
