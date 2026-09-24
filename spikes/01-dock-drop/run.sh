#!/bin/sh
# PROTOTYPE — spike 01. One command: build, patch Info.plist, ad-hoc sign, register.
#   ./run.sh regular    variant "regular"  (stock tinyjs launch)
#   ./run.sh            variant "hidden" (default)   (+ TinyjsActivation=accessory, NO LSUIElement)
set -e
cd "$(dirname "$0")/app"
VARIANT=${1:-hidden}
tinyjs build >/dev/null
APP="$PWD/dist/DropliftSpike01.app"
PL="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
$PB -c "Delete :CFBundleDocumentTypes" "$PL" 2>/dev/null || true
$PB -c "Add :CFBundleDocumentTypes array" \
    -c "Add :CFBundleDocumentTypes:0 dict" \
    -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string Any item" \
    -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer" \
    -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string Alternate" \
    -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" \
    -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string public.item" \
    -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:1 string public.folder" "$PL"
if [ "$VARIANT" = hidden ]; then
  $PB -c "Add :TinyjsActivation string accessory" "$PL"
fi
plutil -lint "$PL" >/dev/null
codesign --force --sign - "$APP/Contents/MacOS/dropliftspike01" 2>/dev/null
codesign --force --sign - "$APP/Contents/MacOS/tjs" 2>/dev/null
codesign --force --sign - "$APP"
codesign --verify --strict --deep "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
echo "built $VARIANT: $APP"
