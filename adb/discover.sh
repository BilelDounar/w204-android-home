#!/bin/sh
# W204 head unit — first-contact inventory. READ-ONLY: changes nothing on the unit.
# Usage: adb/discover.sh [serial]      -> writes adb/reports/<timestamp>/
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
S=${1:-}
A="adb"; [ -n "$S" ] && A="adb -s $S"
command -v adb >/dev/null || { echo "adb introuvable (brew install android-platform-tools)"; exit 1; }

n=$(adb devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')
if [ "$n" = "0" ]; then
  echo "Aucun appareil autorisé. adb devices :"; adb devices -l
  echo "→ Active Options développeur + Débogage USB, puis accepte la clé RSA sur l'écran de l'unité."; exit 1
fi
if [ "$n" -gt 1 ] && [ -z "$S" ]; then echo "Plusieurs appareils : précise le serial."; adb devices -l; exit 1; fi

OUT="$HERE/reports/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$OUT"
T=""; command -v timeout >/dev/null && T="timeout 20"; command -v gtimeout >/dev/null && T="gtimeout 20"
# 20 s max per command: one stuck command must not block the inventory.
# The whole command line is sent as ONE string to the remote shell (pipes run on the device).
sh_() { if [ "$1" = sh ] && [ "$2" = -c ]; then shift 2; fi; $T $A shell "$*" 2>&1 | tr -d '\r'; }
save() { f="$1"; shift; sh_ "$@" > "$OUT/$f"; }

echo "→ Rapport : $OUT"
adb devices -l > "$OUT/00_devices.txt"

# --- identité & système
save 01_getprop.txt getprop
{
  for p in ro.product.manufacturer ro.product.model ro.product.device ro.product.board ro.board.platform \
           ro.build.version.release ro.build.version.sdk ro.build.display.id ro.build.fingerprint \
           ro.product.cpu.abilist ro.hardware ro.build.type ro.debuggable ro.secure persist.sys.locale \
           ro.fota.platform ro.fyt.uiid ro.build.mtc.version ro.sys.mtc ro.product.customize; do
    printf '%-32s %s\n' "$p" "$(sh_ getprop "$p")"
  done
} > "$OUT/02_identity.txt"
save 03_uname.txt uname -a
save 04_meminfo.txt cat /proc/meminfo
save 05_cpuinfo.txt cat /proc/cpuinfo
save 06_df.txt df -h

# --- écran (layout de l'onglet Accueil)
{ sh_ wm size; sh_ wm density; sh_ dumpsys display | grep -E 'mBaseDisplayInfo|DisplayDeviceInfo|refreshRate|fps' | head -20; } > "$OUT/10_display.txt"
save 11_gpu.txt sh -c "dumpsys SurfaceFlinger | grep -iE 'GLES|EGL|vulkan' | head -20"

# --- WebView / navigateur (pour le GLB three.js)
save 20_webview.txt dumpsys webviewupdate
save 21_chrome_like.txt sh -c "pm list packages | grep -iE 'webview|chrome|browser'"

# --- paquets : tout + filtres (décodeur CAN, launcher, CarPlay, apps)
save 30_packages_all.txt pm list packages -f
save 31_packages_3rdparty.txt pm list packages -3
save 32_packages_can_car.txt sh -c "pm list packages | grep -iE 'canbus|\.can\.|carlink|carplay|\.car\.|syu|mtc|fyt|hct|ts10|ts18|zxw|hiworld|raise|simplesoft|decoder|vehicle|mcu|launcher' | grep -v carrier"
save 33_packages_apps.txt sh -c "pm list packages | grep -iE 'waze|spotify|deezer|maps|carplay|zlink|autokit|carbit|easyconn|tlink|androidauto|gearhead'"
save 34_home_activity.txt cmd package resolve-activity --brief -c android.intent.category.HOME -a android.intent.action.MAIN
save 35_services_can.txt sh -c "dumpsys activity services | grep -iE 'ServiceRecord.*(can|car|mcu|syu|fyt|mtc)' | sort -u | head -60"

# --- multi-fenêtre (Waze à droite) : lecture seule des réglages
{
  for k in enable_freeform_support force_resizable_activities development_settings_enabled adb_enabled; do
    printf '%-32s %s\n' "global.$k" "$(sh_ settings get global "$k")"
  done
  echo "feature freeform: $(sh_ pm has-feature android.software.freeform_window_management)"
  echo "feature PiP: $(sh_ pm has-feature android.software.picture_in_picture)"
} > "$OUT/40_multiwindow.txt"

# --- médias & notifications (onglet musique)
save 50_media_session.txt dumpsys media_session
save 51_notification_listeners.txt settings get secure enabled_notification_listeners
save 52_overlay_appops.txt sh -c "appops query-op SYSTEM_ALERT_WINDOW allow 2>/dev/null | head -40"

# --- matériel : ports série (UART du décodeur CAN), USB, Bluetooth
save 60_tty.txt sh -c "ls -l /dev/ | grep -E 'tty(S|HS|MT|MSM|USB|ACM|mxc|AMA)'"
save 61_usb.txt sh -c "dumpsys usb | head -80"
save 62_bluetooth.txt sh -c "dumpsys bluetooth_manager | grep -iE 'name|address|state|enabled|bonded' | head -40"
save 63_input_devices.txt sh -c "grep -E \"^N:\" /proc/bus/input/devices | head -40"
save 64_root.txt sh -c "command -v su || echo 'pas de su'; id"

# --- logs récents filtrés CAN/MCU (5 s, sans vider le buffer)
save 70_logcat_can.txt sh -c "logcat -d -t 3000 -v time | grep -iE 'can|mcu|canbus|decoder|steering|reverse|door' | tail -300"

# --- capture d'écran
$T $A exec-out screencap -p > "$OUT/80_screen.png" 2>/dev/null

# --- résumé
{
  echo "# Résumé"; echo
  sed -n '1,8p' "$OUT/02_identity.txt"; echo
  grep -E 'Physical size|Override size|Physical density' "$OUT/10_display.txt"
  echo; echo "WebView:"; grep -iE 'Current WebView package|versionName' "$OUT/20_webview.txt" | head -3
  echo; echo "Paquets CAN/voiture ($(wc -l < "$OUT/32_packages_can_car.txt" | tr -d ' ')):"; head -25 "$OUT/32_packages_can_car.txt"
  echo; echo "Apps:"; cat "$OUT/33_packages_apps.txt"
  echo; echo "Launcher par défaut:"; tail -1 "$OUT/34_home_activity.txt"
  echo; cat "$OUT/40_multiwindow.txt"
  echo; echo "Ports série:"; cat "$OUT/60_tty.txt"
  echo; echo "Root:"; cat "$OUT/64_root.txt"
} > "$OUT/SUMMARY.md"
cat "$OUT/SUMMARY.md"
