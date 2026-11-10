# Restoring / updating the head unit (W204 app)

Everything the W204 app changed on the head unit, and how to undo it. Run from the Mac, unit plugged in by USB
(Developer options → ⋮ → "computer connection", which resets when the starter cranks).

## Update the app (normal case)

```bash
cd ~/Dev/W204/web && npm run build && cd ../android && ./gradlew assembleDebug && cd .. && adb/install.sh
```
`adb/install.sh` installs over the existing app (same signing key, settings kept) and re-enables the split-screen
accessibility service, which an update switches off.

**Signing key:** `android/signing/w204.keystore` (copy of the Mac's debug key). Back it up outside the Mac. Without it,
an update can't install over the app; you would have to uninstall it and lose the LED settings, service date and records.

## Back to the original head unit (remove everything)

```bash
adb shell settings delete secure enabled_accessibility_services     # split-screen helper (was empty before)
adb shell settings put secure accessibility_enabled 0
adb shell appops set fr.w204.home SYSTEM_ALERT_WINDOW default       # auto start in front
adb uninstall fr.w204.home                                          # app, auto start, LED control, GPS permission
```
Nothing else was changed: the decoder, the factory settings and the CAN bus were never written.
The stock Mercedes-style launcher stayed the HOME app the whole time.

## Full backup taken before the first install

`backups/<device>-<date>/` (settings, sdcard, adb backup), made by `adb/backup.sh`.
Restore one setting from `settings_*.txt` with `adb shell settings put <ns> <key> <value>`.

## LED controller

LEDCAR-01-xxxx (BLE). The app connects at start; LED LAMP (phone or unit) can't connect at the same time.
"Ouvrir LED LAMP" in the Éclairage panel releases the LEDs first.
