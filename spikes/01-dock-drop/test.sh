#!/bin/sh
# PROTOTYPE — spike 01 automated checks. Uses `open -a` (same openFiles Apple
# Event as a Dock drop) + a CGWindowList watcher to catch window flashes.
cd "$(dirname "$0")"
APP="$PWD/app/dist/DropliftSpike01.app"
LOG="$HOME/Library/Logs/droplift-spike-01.log"
FX="$PWD/fixtures"
rm -rf "$FX"; mkdir -p "$FX/folder/sub"
for i in 01 02 03 04 05 06 07 08 09 10 11 12; do echo "shot $i" > "$FX/screenshot $i.png"; done
cp /System/Library/Desktop\ Pictures/*.heic "$FX/" 2>/dev/null | true
printf '\xff\xd8\xff\xe0 fake jpg' > "$FX/photo.jpg"
printf '%%PDF-1.4 fake' > "$FX/doc.pdf"
(cd "$FX" && echo z > z.txt && zip -q archive.zip z.txt && rm z.txt)
echo x > "$FX/folder/sub/a.txt"; echo "ünïcode" > "$FX/名前 ünï.txt"

quit() { osascript -e 'tell application id "app.droplift.spike01" to quit' >/dev/null 2>&1; sleep 0.5; pkill -f DropliftSpike01.app >/dev/null 2>&1; sleep 0.5; }
case_run() {  # name, cold|warm, open-args...
  name=$1; mode=$2; shift 2
  [ "$mode" = cold ] && quit
  echo "===== $name ($mode)"; echo "----- CASE $name" >> "$LOG"
  ./tools/winwatch DropliftSpike01 3 > /tmp/ww.$$ &
  W=$!
  t=$(perl -MTime::HiRes=time -e 'printf "%.0f", time*1000')
  open -a "$APP" "$@"
  t2=$(perl -MTime::HiRes=time -e 'printf "%.0f", time*1000')
  ( for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      printf '%s ' "$(lsappinfo info -only ApplicationType -app app.droplift.spike01 2>/dev/null | sed 's/.*=//;s/"//g' | cut -c1-2)"; sleep 0.1; done; echo ) > /tmp/at.$$
  wait $W
  echo "open returned after $((t2-t))ms; $(cat /tmp/ww.$$)"
  echo "type every 100ms: $(cat /tmp/at.$$)"
  echo "dock: $(lsappinfo info -only ApplicationType -app app.droplift.spike01 2>/dev/null)"
  sed -n "/----- CASE $name\$/,\$p" "$LOG" | grep -v -- '----- CASE' | sed 's/^[^ ]* //' | cut -c1-220
}
case_run nofiles-cold cold
case_run one-file-cold cold "$FX/screenshot 01.png"
case_run twelve-files-cold cold "$FX"/screenshot*.png
case_run warm-1-file warm "$FX/doc.pdf"
case_run warm-types warm "$FX/photo.jpg" "$FX/doc.pdf" "$FX/archive.zip" "$FX/folder" "$FX/名前 ünï.txt"
case_run types-cold cold "$FX/photo.jpg" "$FX/doc.pdf" "$FX/archive.zip" "$FX/folder"
quit
./tools/defaults > defaults-after.txt; diff defaults-before.txt defaults-after.txt && echo "default openers unchanged"
