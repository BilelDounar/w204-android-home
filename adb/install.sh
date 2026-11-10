#!/bin/sh
# Builds and installs the W204 app on the unit. CHANGES THE UNIT: run only with the user's OK (docs/adb-playbook.md §3).
# Usage: adb/install.sh [demo] [serial]
#   demo : starts with the demo data source (native -> JS chain check), otherwise idle (contact on, no decoder data yet)
# Undo:  adb uninstall fr.w204.home
set -eu
HERE=$(cd "$(dirname "$0")" && pwd); ROOT="$HERE/.."
MODE=${1:-idle}; S=${2:-}; A="adb"; [ -n "$S" ] && A="adb -s $S"
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}

(cd "$ROOT/web" && npm run build >/dev/null)
(cd "$ROOT/android" && ./gradlew assembleDebug -q)
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

$A install -r "$APK"
# a reinstall clears the accessibility service (split view helper): re-enable it (user approved 2026-11-10)
$A shell settings put secure enabled_accessibility_services fr.w204.home/fr.w204.home.SplitAccess
$A shell settings put secure accessibility_enabled 1
# music metadata (title / artist) — reversible: adb shell cmd notification disallow_listener fr.w204.home/fr.w204.home.MediaListener
$A shell cmd notification allow_listener fr.w204.home/fr.w204.home.MediaListener || true
$A shell am start -n fr.w204.home/.MainActivity --es source "$MODE"
echo "Lancée. Debug de la page : chrome://inspect sur le Mac (WebView W204)."
