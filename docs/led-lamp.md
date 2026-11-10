# LED LAMP: aftermarket BLE ambient lighting

The user drives the car's aftermarket LED strips from iPhone with **LED LAMP**
([App Store](https://apps.apple.com/app/id1449109039)). The Android version exists on Google Play:
**[LED LAMP, `com.ledlamp`](https://play.google.com/store/apps/details?id=com.ledlamp)**.

## Step 1: shortcut (done)

The bulb button of the dock (home screen) opens `com.ledlamp`. If the app is missing, the unit opens its Play Store page.
Install it **from Google Play on the unit** (official source). No APK downloaded from third-party sites.

## Step 2: native control (later, doc §8.3 "Lights" tab)

Goal: drive the LEDs straight from our app (colour, brightness, sync with indicators / brake / reverse / doors).
1. On the unit: Developer options → **Bluetooth HCI snoop log** (read-only), use LED LAMP (on/off, colours, brightness).
2. Pull the log (`adb bugreport` or `/data/misc/bluetooth/logs`), open it in Wireshark: BLE service/characteristic and frames.
3. Many controllers of this app family use a simple `0xFFF0/0xFFF3` service with 9-byte frames (`7E … EF`):
   **to confirm on the user's controller**, not taken for granted.
4. Write a small BLE module in the Android app (connect, send the frames), exposed to the page (`w204.led(...)`).

Precaution: the controller only accepts one BLE connection at a time. LED LAMP and our app must not be connected together.

## Step 2 done (2026-11-10): native control in the app

The bulb button opens the « Éclairage » panel (`web/app/src/led.js` → `LedBle.kt`). The user's controller is **LEDCAR-01-xxxx**
(advertises service `FFB0`, write characteristic `FFE1`). The unit's BT stack reports every name as
"noName" in `device.name`: the name comes from the scan record. Frames read from LED LAMP 4.3.7 (`NetConnectBle`):

| Action | LEDCAR-01/02 (confirmed on the car) | LEDBLE family |
| --- | --- | --- |
| on / off | `7B FF 04 01|00 FF FF FF FF BF` | `7E FF 04 01|00 00 FF FF 00 EF` |
| colour | `7B 00 07 R G B 00 FF BF` | `7E FF 05 03 R G B FF EF` |
| brightness 0-100 | `7B FF 01 v*32/100 v 00 FF FF BF` | `7E FF 01 v 00 FF FF FF EF` |

The controller accepts a single connection: LED LAMP (phone or unit) must be closed. Saved address: pref `led_addr`.
