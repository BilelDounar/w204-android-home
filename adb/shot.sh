#!/bin/sh
# Captures the unit's screen -> adb/reports/shots/<timestamp>.png  (design loop: build → install → screencap)
set -u
HERE=$(cd "$(dirname "$0")" && pwd); S=${1:-}; A="adb"; [ -n "$S" ] && A="adb -s $S"
mkdir -p "$HERE/reports/shots"; F="$HERE/reports/shots/$(date +%Y%m%d-%H%M%S).png"
$A exec-out screencap -p > "$F" && echo "$F"
