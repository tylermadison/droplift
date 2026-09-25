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

# Info.plist (tinyjs build rewrites it): start hidden, accept any file (PRD D2, spike 01 F2 + F9).
PL="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
$PB -c "Delete :TinyjsActivation" -c "Delete :CFBundleDocumentTypes" "$PL" 2>/dev/null || true
$PB -c "Add :TinyjsActivation string accessory" \
    -c "Add :CFBundleDocumentTypes array" \
    -c "Add :CFBundleDocumentTypes:0 dict" \
    -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string Any item" \
    -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer" \
    -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string Alternate" \
    -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" \
    -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string public.item" \
    -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:1 string public.folder" \
    -c "Add :CFBundleDocumentTypes:1 dict" \
    -c "Add :CFBundleDocumentTypes:1:CFBundleTypeName string Common files" \
    -c "Add :CFBundleDocumentTypes:1:CFBundleTypeRole string Viewer" \
    -c "Add :CFBundleDocumentTypes:1:LSHandlerRank string Alternate" \
    -c "Add :CFBundleDocumentTypes:1:LSItemContentTypes array" "$PL"
i=0
for u in public.image public.movie public.audio com.adobe.pdf public.text public.archive public.zip-archive public.data; do
  $PB -c "Add :CFBundleDocumentTypes:1:LSItemContentTypes:$i string $u" "$PL"; i=$((i+1))
done
plutil -lint "$PL" >/dev/null

cp "$ROOT/engine/bin/droplift-engine" "$APP/Contents/MacOS/droplift-engine"
chmod +x "$APP/Contents/MacOS/droplift-engine"
for f in "$APP/Contents/MacOS/droplift-engine" "$APP"/Contents/MacOS/*; do
  codesign --force --options runtime --timestamp=none -s "$ID" "$f" 2>/dev/null || true
done
codesign --force --options runtime --timestamp=none -s "$ID" "$APP"
codesign --verify --strict "$APP"
echo "built: $APP (signed with: $ID)"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
