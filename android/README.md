# W204 Home: Android app

Kotlin shell that shows the home scene (`web/app`) full screen in a WebView. **It does not replace the stock launcher**:
the Mercedes-style interface of the unit stays the default; the page's **3×3** button opens it.

## Build / install

```bash
cd web && npm run build                     # web bundle (web/app/dist/app.js)
cd android && ./gradlew assembleDebug       # APK: android/app/build/outputs/apk/debug/app-debug.apk
adb/install.sh [demo]                       # build + install + launch (with the user's OK)
```

Requirements on the Mac: JDK 17 (`/opt/homebrew/opt/openjdk@17`), Android SDK (platform 34). Gradle via `./gradlew`.

## Structure

| File | Role |
| --- | --- |
| `MainActivity.kt` | Full-screen WebView, assets served by `WebViewAssetLoader` (`https://appassets.androidplatform.net/assets/web/`), `W204Native` bridge |
| `VehicleSource.kt` | Vehicle data source: **decoder box + MCU only** (never OBD). `IdleSource` (contact on) and `DemoSource` for now; the real source will be written after `adb/can_capture.sh` |
| `MediaWatcher.kt` | Title / artist / play state of the active media session (needs notification access, granted by `install.sh`) |

## JS ↔ native contract

- native → page: `w204.update({...})` (raw signals, see `web/app/src/signals.js`), `w204.media({...})`, `w204.config({...})`
- page → native: `W204Native.onEvent(json)`. Events: `ready`, `openLauncher` (3×3), `openApp` (`com.ledlamp`), `media` (prev/toggle/next), `openVehicle` («i»)

## Settings through adb (no rebuild)

```bash
adb shell am start -n fr.w204.home/.MainActivity --es source demo          # demo | idle
adb shell am start -n fr.w204.home/.MainActivity --es launcher <pkg>/<activity>   # stock launcher to open with 3×3
```

The stock launcher is detected automatically (HOME activity other than ours). If the unit has several, `discover.sh`
(file `34_home_activity.txt`) gives the right one, to set with `--es launcher`.

## Debug from the Mac (without Chrome)

```bash
adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof fr.w204.home)
# then any DevTools-protocol client (e.g. Runtime.evaluate) on http://127.0.0.1:9333/json
```

## Debug

`chrome://inspect` on the Mac, with the unit connected over USB: the page's console and inspector (the WebView is debuggable).
