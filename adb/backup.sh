#!/bin/sh
# Backs up the unit BEFORE any change. READ-ONLY on the unit (it only reads and copies to the Mac).
# Usage: adb/backup.sh [--no-sdcard] [serial]   -> backups/<model>-<date>/
#   apks/        every installed app that isn't from the system image (base + splits), reinstallable with adb install(-multiple)
#   settings/    settings global/secure/system, getprop, packages, default launcher, permissions
#   sdcard/      shared storage (/sdcard) unless --no-sdcard
#   adb-backup.ab  legacy adb backup attempt (deprecated on recent Android; often empty — confirm on the unit's screen if asked)
# Limits: no root -> no private app data (/data/data); the firmware itself is not backed up (only the manufacturer can reflash it).
set -u
NOSD=0; [ "${1:-}" = "--no-sdcard" ] && { NOSD=1; shift; }
S=${1:-}; A="adb"; [ -n "$S" ] && A="adb -s $S"
$A get-state >/dev/null 2>&1 || { echo "Aucun appareil autorisé (adb devices)."; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
MODEL=$($A shell getprop ro.product.model | tr -d '\r' | tr ' /' '__')
OUT="$HERE/../backups/${MODEL}-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$OUT/apks" "$OUT/settings"
sh_() { $A shell "$*" 2>/dev/null | tr -d '\r'; }
echo "→ Sauvegarde dans $OUT"

# 1. settings & system state (enough to put things back as they were)
for ns in global secure system; do sh_ settings list $ns > "$OUT/settings/settings_$ns.txt"; done
sh_ getprop > "$OUT/settings/getprop.txt"
sh_ pm list packages -f -i -U > "$OUT/settings/packages_all.txt"
sh_ pm list packages -3 > "$OUT/settings/packages_user.txt"
sh_ pm list packages -d > "$OUT/settings/packages_disabled.txt"
sh_ cmd package resolve-activity --brief -c android.intent.category.HOME -a android.intent.action.MAIN > "$OUT/settings/home_activity.txt"
sh_ dumpsys package preferred-activities > "$OUT/settings/preferred_activities.txt"
sh_ appops query-op SYSTEM_ALERT_WINDOW allow > "$OUT/settings/overlay_allowed.txt"
sh_ settings get secure enabled_notification_listeners > "$OUT/settings/notification_listeners.txt"
sh_ dumpsys wifi | grep -E "SSID|ConfigKey" | head -50 > "$OUT/settings/wifi_networks.txt"
echo "  réglages : ok"

# 2. user-installed apps (and updated system apps), with their splits
for pkg in $(sh_ pm list packages -3 | sed 's/package://'); do
  mkdir -p "$OUT/apks/$pkg"
  for p in $(sh_ pm path "$pkg" | sed 's/package://'); do $A pull "$p" "$OUT/apks/$pkg/" >/dev/null 2>&1; done
  ver=$(sh_ dumpsys package "$pkg" | grep -m1 versionName | sed 's/.*=//'); echo "$pkg $ver" >> "$OUT/apks/index.txt"
done
echo "  applis : $(wc -l < "$OUT/apks/index.txt" | tr -d ' ') sauvegardées"

# 3. shared storage
if [ $NOSD = 0 ]; then
  $A pull /sdcard/ "$OUT/sdcard" >/dev/null 2>&1 && echo "  /sdcard : $(du -sh "$OUT/sdcard" | cut -f1)"
fi

# 4. legacy adb backup (may need a tap on the unit; harmless if refused)
( $A backup -apk -shared -all -f "$OUT/adb-backup.ab" >/dev/null 2>&1 & sleep 25; kill $! 2>/dev/null ) 2>/dev/null
[ -s "$OUT/adb-backup.ab" ] && echo "  adb backup : $(du -h "$OUT/adb-backup.ab" | cut -f1)" || echo "  adb backup : vide/refusé (normal sur Android récent)"

cat > "$OUT/RESTORE.md" <<'EOF'
# Put the unit back as it was
- Remove our app: `adb uninstall fr.w204.home`
- Reinstall a saved app: `adb install-multiple -r apks/<pkg>/*.apk` (or `adb install -r` if there is only base.apk)
- Default launcher: see settings/home_activity.txt -> Settings > Apps > Default apps, or
  `adb shell cmd package set-home-activity <pkg>/<activity>`
- A modified setting: settings/settings_*.txt give the original value -> `adb shell settings put <ns> <key> <value>`
- Files: `adb push sdcard/. /sdcard/`
EOF
echo "Terminé : $OUT  (voir RESTORE.md)"
