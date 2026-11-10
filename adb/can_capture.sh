#!/bin/sh
# Guided capture of what the CAN decoder box sends to the unit. READ-ONLY.
# Usage: adb/can_capture.sh [serial]   -> adb/reports/capture-<date>/
# You perform each action when prompted; the script timestamps each step in the logs.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); S=${1:-}; A="adb"; [ -n "$S" ] && A="adb -s $S"
adb devices | awk 'NR>1 && $2=="device"' | grep -q . || { echo "Aucun appareil autorisé."; exit 1; }
OUT="$HERE/reports/capture-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$OUT"

# CAN / MCU-related packages present on the unit
$A shell pm list packages | tr -d '\r' | sed 's/package://' | grep -iE 'can|mcu|syu|fyt|hct|mtc|ts10|ts18|hiworld|raise|simple|decoder' > "$OUT/packages.txt"
echo "Paquets CAN/MCU :"; cat "$OUT/packages.txt"
for p in $(cat "$OUT/packages.txt"); do
  $A shell dumpsys package "$p" | tr -d '\r' > "$OUT/pkg_$p.txt"
  $A shell dumpsys activity services "$p" | tr -d '\r' > "$OUT/svc_$p.txt"
done
$A shell getprop | tr -d '\r' | grep -iE 'can|mcu|syu|fyt|car|vehicle' > "$OUT/props_can.txt"

# full logcat in the background (main + system + events), with timestamps
$A logcat -c 2>/dev/null
$A logcat -v threadtime -b main -b system -b events > "$OUT/logcat.txt" 2>&1 &
LOG=$!
trap 'kill $LOG 2>/dev/null' EXIT INT TERM

mark() { ts=$(date +%H:%M:%S); echo "$ts $1" >> "$OUT/steps.txt"; $A shell log -t W204CAP "STEP $1" >/dev/null 2>&1; }
step() { printf '\n→ %s, puis Entrée (s pour passer) : ' "$1"; read -r r; [ "$r" = "s" ] && return; mark "$1"; sleep 4; mark "$1 (fin)"; }

echo "Capture en cours dans $OUT"
step "Contact mis (moteur coupé)"
step "Démarrer le moteur"
step "Ouvrir puis fermer la porte avant gauche"
step "Ouvrir puis fermer la porte avant droite"
step "Ouvrir puis fermer la porte arrière gauche"
step "Ouvrir puis fermer la porte arrière droite"
step "Ouvrir puis fermer le coffre"
step "Allumer les veilleuses puis les éteindre"
step "Allumer les feux de croisement"
step "Allumer les feux de route (plein phare) puis revenir en croisement"
step "Antibrouillards on/off"
step "Clignotant gauche 5 s"
step "Clignotant droit 5 s"
step "Warnings 5 s"
step "Frein à main serré puis desserré"
step "Appuyer sur la pédale de frein 3 fois"
step "Passer la marche arrière puis revenir en P"
step "Boutons au volant : volume +/−, piste suivante/précédente"
step "Rouler quelques mètres (si possible)"
kill $LOG 2>/dev/null
grep -n "W204CAP" "$OUT/logcat.txt" | head -80 > "$OUT/markers.txt"
echo; echo "Fini. Fichiers : $OUT  (logcat.txt, steps.txt, markers.txt)"
