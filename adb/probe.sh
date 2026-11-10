#!/bin/sh
# Opens a web page from web/ ON THE UNIT, served from the Mac over the USB cable (adb reverse).
# Usage: adb/probe.sh [probe|home] [serial]
#   probe : 3D test (FPS, GPU, WebView)        home : home-screen startup sequence
# Stop with Ctrl+C (removes the reverse mapping).
set -u
HERE=$(cd "$(dirname "$0")" && pwd); ROOT="$HERE/.."
PAGE=${1:-probe}; S=${2:-}; A="adb"; [ -n "$S" ] && A="adb -s $S"
PORT=8780
cp "$ROOT/glb/w204_facelift_black.glb" "$ROOT/glb/w204_facelift_white.glb" "$ROOT/web/probe/" 2>/dev/null
python3 -m http.server $PORT --bind 127.0.0.1 --directory "$ROOT/web" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; $A reverse --remove tcp:$PORT 2>/dev/null' EXIT INT TERM
$A reverse tcp:$PORT tcp:$PORT
$A shell am start -a android.intent.action.VIEW -d "http://localhost:$PORT/$PAGE/" >/dev/null
echo "Page ouverte sur l'unité : http://localhost:$PORT/$PAGE/  (Ctrl+C pour arrêter)"
echo "Capture : adb/shot.sh"
wait $SRV
