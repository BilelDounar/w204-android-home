# ADB playbook: first connection to the head unit

Goal: as soon as the unit is plugged in over USB, know in **15 minutes** what it allows,
to find out **how the decoder box's data reaches Android** (the only allowed source: no OBD, no ESP32; see `docs/donnees-decodeur.md`).
Reference: `W204 phase 2 — Données CAN exploitables & refonte d'une interface Android.md` (§5–8).

## 0. On your side (before plugging in)

1. On the unit: **Settings → About → tap "Build number" 7 times** → Developer options.
   On many Chinese units (FYT/UIS, MTCx, TS10/TS18) developer options sit behind a factory menu, often code `8888`, `1234`, `126` or `3368`.
2. Enable **USB debugging** (and *Wireless debugging* if it's there, as a backup).
3. USB cable to the Mac, on the unit's **data/OTG** port (not the charging-only port).
4. Accept the **RSA key** prompt on the unit's screen ("Always allow").
5. Check: `adb devices` must show `device` (not `unauthorized`).

## 1. What I run first (all read-only)

| Step | Command | What it tells us |
| --- | --- | --- |
| **Backup** | `adb/backup.sh` | **first, before anything else**: settings, launcher, permissions, every installed app (APK + splits), /sdcard → `backups/<model>-<date>/` + `RESTORE.md` |
| Inventory | `adb/discover.sh` | model, Android/SDK, screen, GPU, WebView, CAN/launcher/CarPlay packages, multi-window, serial ports, root → `adb/reports/<date>/SUMMARY.md` |
| Home scene | `adb/probe.sh home` | the startup sequence (turntable → road) on the real screen, with the simulation buttons |
| 3D test | `adb/probe.sh` | the GLB on the unit: FPS, draw calls, WebGL, WebView version. Served from the Mac via `adb reverse`, no internet needed |
| Decoder capture | `adb/can_capture.sh` | guided session (doors, lights, indicators, reverse…) with markers in the logs → table of signals |
| Capture | `adb/shot.sh` | screenshot to check the UI |

Nothing is changed on the unit at this stage: no `settings put`, no `install`, no `appops`.

## 2. Decisions the inventory unlocks

- **Screen** (`10_display.txt`) → exact layout of the home tab (car scene on the left, Waze/music on the right; doc §8.1).
- **WebView** (`20_webview.txt`) and **probe**:
  - Chrome ≥ 89 and ≥ 30 FPS → home scene as a WebView + three.js, using the GLB as is.
  - FPS too low → lower `setPixelRatio`, merge materials (draw calls), or switch to Filament/SceneView natively.
  - importmap not supported → bundle the JS (esbuild) instead of the importmap.
- **CAN packages / services** (`32_`, `35_`) → is there a decoder box (Raise/Hiworld/Simple Soft…)? If so, option C: look at what it exposes (`dumpsys` on its service, broadcasts in `logcat`).
- **Serial ports** (`60_tty.txt`) → which UART the CAN decoder uses (often `/dev/ttyS*`); readable only with root or the system app.
- **Root** (`64_root.txt`) → changes what can be done (UART, launcher, freeform).
- **Multi-window** (`40_`) → whether Waze can sit in a window on the right (doc note on Waze).
- **Launcher** (`34_`) → whether our app can become the HOME activity.

## 3. Actions with side effects (only with your OK, one at a time)

Offline install in the car (our app + LED LAMP): `adb/install_offline.sh`, see `build/apk/README.md` (Waze: install from the unit's Play Store through the iPhone hotspot, procedure in `build/apk/README.md`).
Install our app (build + install): `adb/install.sh [demo]` (undo: `adb uninstall fr.w204.home`). It does not touch the stock launcher.
LED LAMP: install `com.ledlamp` from Google Play on the unit (by the user).

```bash
adb install -r app.apk                                                   # install our app
adb shell appops set <pkg> SYSTEM_ALERT_WINDOW allow                     # overlay on top of CarPlay
adb shell settings put global enable_freeform_support 1                  # multi-window (Waze)
adb shell settings put global force_resizable_activities 1
adb shell cmd package set-home-activity <pkg>/.MainActivity              # replace the launcher (firmware-dependent)
```

Each change gets noted here with its undo command (`settings put … 0`, `pm uninstall`, etc.).

## 4. Safety rules (doc §7)

- **Read-only first.** No UDS writes, no coding (FBS3: ECUs are married to the car).
- Never write to CAN-C while driving; never cut a CAN-B wire (tap in parallel).
- A module that stays awake on the bus can drain the battery: check that it sleeps.
- Nothing distracting while driving: the home tab stays readable, and alerts show as a banner.

## 5. Next steps planned (doc §6)

1. Inventory (`discover.sh`): which decoder, which CAN app, which system service (FYT `com.syu.ms`?).
2. Guided capture (`can_capture.sh`): which signals actually come up (doors, lights, speed, engine?).
3. Pick the reading path: system IPC → broadcasts → logs (READ_LOGS via adb) → serial port (root).
4. Integration: hook the signals up to the 3D scene (`glb/README.md`: doors, lights, wheels), fallbacks for the missing ones.

## Changes made on the unit (2026-11-10)

| Change | Why | Undo |
| --- | --- | --- |
| `appops set fr.w204.home SYSTEM_ALERT_WINDOW allow` | lets the app bring itself to the front when the screen wakes up (auto start) | `adb shell appops set fr.w204.home SYSTEM_ALERT_WINDOW default` |
| `pm grant fr.w204.home ACCESS_FINE_LOCATION` | GPS speed fallback | `adb shell pm revoke fr.w204.home android.permission.ACCESS_FINE_LOCATION` |
| app sends `MAIN cmd(0, 3)` when BT music plays | switches the audio source to BT music (same as opening the stock BT app), otherwise music plays silently | remove `ensureBtAudio()` in `SyuSource.kt` |
| auto start (`AutoStartService` + `BootReceiver`) | W204 screen in front at boot and at every screen wake-up | uninstall, or `adb shell am stopservice fr.w204.home/.AutoStartService` |
| `settings put secure enabled_accessibility_services fr.w204.home/fr.w204.home.SplitAccess` + `accessibility_enabled 1` (2026-11-10, was empty) | split view button (toggle split screen + drag divider to 1/3) | `adb shell settings delete secure enabled_accessibility_services; adb shell settings put secure accessibility_enabled 0` |
