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
# public.item is a "wildcard" claim: Launch Services hides wildcard apps from Finder's
# Open With list. A second type with specific UTIs puts the app in the list (still Alternate).
$PB -c "Add :CFBundleDocumentTypes:1 dict" \
    -c "Add :CFBundleDocumentTypes:1:CFBundleTypeName string Common files" \
    -c "Add :CFBundleDocumentTypes:1:CFBundleTypeRole string Viewer" \
    -c "Add :CFBundleDocumentTypes:1:LSHandlerRank string Alternate" \
    -c "Add :CFBundleDocumentTypes:1:LSItemContentTypes array" "$PL"
i=0
for u in public.image public.movie public.audio com.adobe.pdf public.text public.archive public.zip-archive public.data; do
  $PB -c "Add :CFBundleDocumentTypes:1:LSItemContentTypes:$i string $u" "$PL"; i=$((i+1))
done
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
