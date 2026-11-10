#!/bin/sh
# Installs every APK in build/apk/ on the unit WITHOUT internet (cable only). CHANGES THE UNIT: with the user's OK.
#   build/apk/w204-home.apk        our app (rebuilt by adb/install.sh or android/./gradlew assembleDebug)
#   build/apk/ledlamp-4.3.7.apk    LED LAMP, copied from the official Play Store install on the tablet (publisher signature checked)
#   build/apk/<name>/              a folder of split APKs (base + config.*) is installed in one go (install-multiple)
# Usage: adb/install_offline.sh [serial]
# Undo:  adb uninstall fr.w204.home ; adb uninstall com.ledlamp
set -u
HERE=$(cd "$(dirname "$0")" && pwd); DIR="$HERE/../build/apk"
S=${1:-}; A="adb"; [ -n "$S" ] && A="adb -s $S"
$A get-state >/dev/null 2>&1 || { echo "Aucun appareil autorisé (adb devices)."; exit 1; }
echo "Appareil : $($A shell getprop ro.product.model | tr -d '\r') — ABI $($A shell getprop ro.product.cpu.abi | tr -d '\r')"

for f in "$DIR"/*.apk; do
  [ -e "$f" ] || continue
  printf '→ %s … ' "$(basename "$f")"; $A install -r "$f" 2>&1 | tail -1
done
for d in "$DIR"/*/; do
  [ -d "$d" ] || continue
  set -- "$d"*.apk; [ -e "$1" ] || continue
  printf '→ %s (splits) … ' "$(basename "$d")"; $A install-multiple -r "$@" 2>&1 | tail -1
done

# our app: music metadata access (reversible: cmd notification disallow_listener …)
$A shell cmd notification allow_listener fr.w204.home/fr.w204.home.MediaListener >/dev/null 2>&1 || true
$A shell am start -n fr.w204.home/.MainActivity >/dev/null && echo "W204 lancée."
