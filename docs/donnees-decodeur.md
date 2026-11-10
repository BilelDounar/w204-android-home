# Data source: the CAN decoder box only (no OBD)

**Decision (user, 2026-11-09):** nothing is plugged into the OBD port, and no data comes from it. No ESP32 on the
CAN wires either. **Everything goes through the CAN decoder box already connected between the original harness
and the Android unit** (Raise / Hiworld / Simple Soft type, doc §3.5 and §5.1 option C). The OBD port stays free.

Consequences: no "PID" data (rpm, coolant temperature, boost…) unless the decoder happens to expose it.
We use what the unit's **MCU** (wired inputs) and the **decoder** (CAN-B → UART) send to the Android system.

## Where the data reaches Android

```
CAN-B car ──► decoder box ──UART──► MCU of the unit ──► system service (com.syu.ms on FYT)
                                                    └─► CAN app (com.syu.canbus …) : doors, climate, radar screens
Wired harness inputs (ACC, reverse, lighting, handbrake, speed pulse) ──► MCU ──► same service
```

Ways for our app to read it, from cleanest to most fragile (to confirm on the unit, `adb/discover.sh`):

1. **The system service's IPC** (FYT/SYU: `com.syu.ms`, remote "toolkit" service exposing the modules: main, canbus, sound…).
   Community apps use it to read doors, speed, etc. **To verify**: exact name, interface, codes.
2. **Broadcasts / content providers** from the CAN app, if it publishes them (`dumpsys` on its components).
3. **Reading the logs** of the CAN app (`logcat`), if it logs the frames: our app can get the permission with
   `adb shell pm grant <pkg> android.permission.READ_LOGS` (one-off adb grant, reversible).
4. **Reading the decoder's serial port** directly (`/dev/ttyS*`): needs root, and the port is already owned by the MCU. Last resort.

## Which data for the home screen (and fallbacks)

| Need (scene) | Expected source | Reliability | Fallback if missing |
| --- | --- | --- | --- |
| Contact on (`acc`) | ACC wire of the harness → MCU | ✅ | none needed: the unit only wakes with ACC |
| Contact off | ACC → 0 → MCU | ✅ | ⚠️ the unit usually goes to sleep straight away: the reverse animation is rarely seen |
| **Engine running** (`starting`) | "engine running" bit or rpm **if** the decoder sends them | 🔴 | ① battery voltage > 13.2 V (alternator) if the MCU exposes it 🟡 · ② first speed > 0 · ③ timer after ACC |
| Speed | decoder (CAN-B) or speed pulse wire | 🟡 | none: the road stays still |
| Doors FL/FR/RL/RR, trunk, hood | decoder (Mercedes protocols generally per door) | 🟡 | "a door is open" (all of them) |
| Dipped / main beam / fog | decoder | 🟡 | lighting wire = on/off only ✅ |
| Indicators / hazard | decoder | 🟡 | not shown |
| Reverse | reverse wire → MCU | ✅ | — |
| Brake lights | decoder (rarely) | 🔴 | deceleration computed from speed (current behaviour) |
| **Day / night theme** | **lighting wire → MCU** | ✅ | system theme |

## What changes in the code

- The scene's data contract (`w204.update({...})`) stays the same; only the side that feeds it changes (MCU/decoder service).
- "Started" is no longer `rpm > 400`: it becomes `engineOn` provided by the source, with the fallbacks ①②③ above, picked in the settings.
- Day/night follows the lighting wire by default (more reliable than the system theme on a head unit).
- Everything that depended on the OBD (Vehicle tab: temperatures, boost, fault codes) moves to "only if the decoder exposes it".
  Doc §8.2 needs revisiting accordingly.

## To capture on the day the unit is connected (`adb/can_capture.sh`)

A scripted, read-only session: we record what the system receives while you perform actions one after another
(contact, start engine, open each door, trunk, dipped/main beam, indicators, hazards, reverse, handbrake, braking).
From that we build the decoder → signals table (our own "DBC").

## Captured on the car (2026-11-10): UIS7862A unit, FYT/SYU platform, ZHTD Benz decoder

Reading path chosen: **system service `syu` / `com.syu.ms.toolkit` (`IRemoteToolkit`)**, implemented in
`android/.../SyuSource.kt`. Module 7 = CANBUS, 0 = MAIN. `update(code, ints…)` callback.

| Signal | Module / code | Raw decoder frame | Note |
| --- | --- | --- | --- |
| Front left door | 7 / 1 | — | ints[0] != 0 = open (FinalCanbus.U_DOOR_FL) |
| Front right door | 7 / 2 | | |
| Rear left door | 7 / 3 | | |
| Rear right door | 7 / 4 | | |
| Trunk | 7 / 5 | | |
| Hood | 7 / 0 | | **not transmitted** by this decoder |
| Headlights (dipped) | 7 / 7 | 0x12 byte 3 bit 0x40 | confirmed engine off & on; position lights not reported |
| Main beam | 7 / 8 | 0x12 byte 3 bit 0x20 | night theme = 0x40 or 0x20 |
| Left indicator | 7 / 9 | 0x12 bit 0x04 | steady state (the app makes it blink) |
| Right indicator | 7 / 10 | 0x12 bit 0x02 | |
| Hazard | — | — | not seen (shown if both indicators are on) |
| Handbrake | 7 / 13 | 0x12 byte 5 bit 0x01 | |
| Reverse | 7 / 18 (and 56) | 0x12 byte 5 bit 0x40 | |
| RPM | 7 / 16 | 0x18 bytes 6-7 | **streamed only after `cmd(4, 1, 0)`** (what the stock "Meter" page does), refreshed every 20 s |
| Speed | 7 / 14 | | read by the Meter page (`updateSpeed`); fallback = unit GPS |
| Dash illumination | 0 / 4 | | -> night theme |
| Brake pedal | — | — | not transmitted -> brake lights estimated from deceleration |
| Raw decoder frames | 7 / 1019 | all | ints = full UART frame (0x2D, type, length, data…, checksum) |

Probe mode for further discovery: `adb shell am start -n fr.w204.home/.MainActivity --es source probe`
(logs every code, tag `W204SYU`); back to normal: `--es source syu`.
USB note: the cable connection only works after Developer options → ⋮ → "computer connection" (other choice);
it resets when the starter motor cuts power.
