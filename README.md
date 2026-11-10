# W204 Home — custom Android head-unit home screen for the Mercedes C-Class W204

**FR** · Écran d'accueil sur mesure pour autoradio Android (FYT / UIS7862 / plateforme SYU) monté dans une
**Mercedes Classe C W204 phase 2 (2011-2014)** : voiture en 3D temps réel, données du véhicule lues depuis le
**boîtier décodeur CAN** (jamais la prise OBD), musique Bluetooth de l'iPhone, éclairage d'ambiance LED BLE,
écran partagé avec Waze.

**EN** · Custom home screen for Chinese Android head units (FYT, UIS7862, SYU platform: "ZHTD", "Joying"-style units)
fitted in a **Mercedes-Benz C-Class W204 facelift**: real-time 3D car, live vehicle data from the **CAN-bus decoder box**
(no OBD dongle), Bluetooth music control, aftermarket BLE ambient LEDs, split screen with Waze.

> Personal project, shared as-is. Not affiliated with Mercedes-Benz, FYT or any app vendor.
> **No 3D model is included** (see [Bring your own 3D model](#bring-your-own-3d-model)).

## Features

| | |
| --- | --- |
| 3D car (three.js) | turntable when parked; contact = hazard flash + headlights + one turn; engine start = drive view with scrolling lane lines; doors, trunk, lights, indicators, reverse, brake lights animated from real data; under-glow tinted with the LED colour; day / night themes |
| Vehicle data | doors, lights, indicators, handbrake, reverse, seatbelt, rpm, speed (decoder or GPS fallback), odometer — read from the CAN decoder through the head unit's own IPC (`com.syu.ms`), see `docs/donnees-decodeur.md` |
| Véhicule panel | odometer, live status, current trip, records, oil-service countdown |
| Music | Bluetooth (A2DP/AVRCP) title / artist / progress / controls via the FYT BT module, automatic switch of the audio source, album art lookup |
| Calls | iOS-style incoming / ongoing call card (answer / decline / hang up) |
| Ambient LEDs | native BLE control of LED-LAMP-app controllers (`LEDCAR-*`, `LEDBLE-*`): presets, free hue, brightness, smart modes (welcome, engine start effects, goodbye, alerts, night dimming, colour by speed, indicators, reverse) — protocol in `docs/led-lamp.md` |
| Layout | full screen (Tesla / Polestar-style bottom bar) and compact layout for Android split screen beside Waze; rotary knob navigation |
| System | auto start on boot / wake (never over the reverse camera), Wi-Fi forced on for the phone hotspot, settings panel, night screen dimming |

## How it works

```
CAN-B ─► decoder box ─UART─► head-unit MCU ─► com.syu.ms (IRemoteToolkit IPC) ─► SyuSource.kt ─► WebView ─► web/app (three.js)
                                                                           FYT BT module ─┘        LedBle.kt ─BLE─► LED controller
```

- `android/` — Kotlin WebView app (`fr.w204.home`). Not a HOME launcher: the stock launcher stays, the 3×3 button opens it.
- `web/app/` — the home screen (vanilla JS + three.js, bundled with esbuild). `?mock=demo` replays a drive, `?dev=1` shows a simulator.
- `adb/` — helper scripts: read-only inventory, backup, guided CAN capture, install, screenshots.
- `tools/glb/` — converter from a BeamNG vehicle mod (DAE + jbeam) to an optimised GLB with hinge nodes.
- `docs/` — decoder signal map, LED protocol, adb playbook, restore procedure, low-end GPU notes.

## Build

```bash
cd web && npm install && npm run build          # web/app/dist/app.js
cd ../android && ./gradlew assembleDebug        # android/app/build/outputs/apk/debug/app-debug.apk
```
Then `adb install -r` the APK (see `adb/install.sh` and `docs/restauration.md`). Requires JDK 17 and the Android SDK.
Signing: provide your own keystore in `android/signing/w204.keystore` (not included).

### Bring your own 3D model

The scene loads `web/app/assets/w204_facelift_black.glb` / `_white.glb`. The models used on the author's car come from a
BeamNG mod whose licence forbids redistribution, so they are **not** in this repository. Any GLB following the contract in
`glb/README.md` works (Y up, car facing +Z, hinge nodes `door_*`, `hood`, `trunk`, `wheel_*`, `LIGHT_*` materials).
`tools/glb/make.sh` rebuilds them from a mod you own locally.

## Safety & scope

- **Read-only on the car**: nothing is ever written to the CAN bus; no OBD adapter, no UDS.
- Changes on the head unit are limited and reversible (accessibility service for split screen, overlay permission for
  auto start): see `docs/restauration.md`. Back up your unit first (`adb/backup.sh`).
- Signal codes were mapped on one car / one decoder (ZHTD Benz on a UIS7862A unit). Other decoders may differ: use the
  probe mode (`--es source probe`, logcat tag `W204SYU`) to map yours.

Keywords: Mercedes W204, C-Class, C200 C220 C250 C350 C63, Android head unit, FYT, UIS7862, SYU, ZHTD, CAN bus decoder,
canbus, custom launcher, three.js car configurator, WebView, LED LAMP, LEDCAR, ELK-BLEDOM-like BLE LED protocol, AVRCP, Waze split screen.

## License

MIT for the code in this repository (see `LICENSE`). Third-party code keeps its own licence (three.js: MIT).
