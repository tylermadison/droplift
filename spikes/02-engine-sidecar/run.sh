#!/bin/sh
# PROTOTYPE — spike 02. One command: build universal engine, build .app,
# embed engine, ad-hoc sign (hardened runtime), launch, print the result log.
set -eu
cd "$(dirname "$0")"
LOG="$HOME/Library/Logs/droplift-spike02.log"
OUT="$PWD/out"; mkdir -p "$OUT"

echo "== engine: universal build"
( cd engine
  GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$OUT/engine-arm64" .
  GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$OUT/engine-amd64" . )
lipo -create -output "$OUT/droplift-engine" "$OUT/engine-arm64" "$OUT/engine-amd64"
lipo -info "$OUT/droplift-engine"

echo "== tinyjs build"
( cd host && tinyjs build )
APP=$(ls -d host/dist/*.app | head -1)
MACOS="$APP/Contents/MacOS"

echo "== embed engine"
cp "$OUT/droplift-engine" "$MACOS/droplift-engine"
chmod +x "$MACOS/droplift-engine"
ls -l "$MACOS"

ID="${TINYJS_SIGN_IDENTITY:--}"
if [ "$ID" = "-" ]; then TS="--timestamp=none"; else TS="--timestamp"; fi
echo "== sign as '$ID', hardened runtime (engine first, then .app)"
codesign --force --options runtime $TS -s "$ID" "$MACOS/droplift-engine"
# tinyjs build leaves Contents/MacOS/tjs (the backend that spawns the engine)
# ad-hoc WITHOUT hardened runtime; notarization needs it on every Mach-O.
codesign --force --options runtime $TS -s "$ID" "$MACOS/tjs"
codesign --force --options runtime $TS -s "$ID" "$APP"
codesign --verify --strict --verbose=2 "$APP"
for b in "$MACOS"/*; do printf "%s " "$(basename "$b")"; codesign -dv "$b" 2>&1 | grep -o "flags=[^ ]*"; done

echo "== launch (waits for the app to quit)"
rm -f "$LOG"
open -W -n "$APP"
echo "== result log: $LOG"
cat "$LOG"
grep -q "RESULT PASS" "$LOG"
