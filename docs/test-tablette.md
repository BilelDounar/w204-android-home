# Test on Android tablet (2026-11-09)

Device: Samsung Galaxy Tab 4 10.1 (SM-T535), LineageOS 16 (Android 9), Snapdragon 400 / **Adreno 305**, 1.35 GB RAM,
WebView 97, 1280×800 screen. A **worst case** that is far slower than a current head unit (UIS7862, Snapdragon 6xx).

## Results

| Test | Result |
| --- | --- |
| `adb/discover.sh` (inventory) | ✅ after fixes (see below) |
| APK install (`adb/install.sh`) | ✅ |
| Native → page chain (`DemoSource` → `w204.update`) | ✅ contact, start, road, speed, indicators, doors |
| 3×3 button → stock launcher | ✅ opens the default HOME activity (here a custom TV launcher) |
| LED button → `com.ledlamp` | ✅ Play Store if missing, then the app once installed (LED LAMP 4.3.7 installed from Play) |
| Media buttons → media keys | ✅ event sent (no player active on the tablet to check the sound) |
| Back from the launcher | ✅ page kept (no reload) |
| Cold start → scene shown | 17 s on this tablet (shaders precompiled: no frozen screen afterwards) |
| Memory | ~69 MB app process |

## Bugs found and fixed thanks to the device

| Problem | Cause | Fix |
| --- | --- | --- |
| Car (and everything lit) **black** | Adreno 3xx drivers render three.js lit shaders black under WebGL2 (PBR *and* Phong) | Automatic detection (test render) → **matcap** materials (lighting baked into a texture, no light uniforms), lamps tinted by colour |
| 6.5 FPS while moving | `backdrop-filter: blur` on the cards (re-blur of the 3D scene every frame) + MSAA | blur removed everywhere, MSAA off on low-end GPUs → **~21 FPS** on this tablet |
| Auto resolution too low (0.5, pixelated) | measured during loading, and no floor | measured only once loaded, floor 0.65 (this GPU is limited by geometry, not pixels) |
| Screen frozen after loading | ~80 shaders compiled on the first frame | `compileAsync` + first frame drawn before the poster goes away |
| Crash in the fallback | plateau converted before it existed | init order fixed |
| `discover.sh` stuck / wrong | `getevent` blocking, `logcat -d` too long, `adb shell sh -c` splitting the pipes | `/proc/bus/input/devices`, `-t 3000`, 20 s timeout per command, commands sent as one string |

## Sharpness (second pass)

- Auto resolution never drops below the screen's native resolution (it went down to 0.5 → pixelated).
- **Still frame refined**: as soon as nothing moves, one frame is redrawn at 2× resolution and scaled down by the display
  (supersampling): clean edges, readable spokes and badges. Zero FPS cost (a single frame), identical colours.
- While moving on a low-end GPU: native resolution without anti-aliasing (MSAA halves the FPS: 23 → 12.6 measured). On a recent unit, MSAA stays on.

## Graphics modes (automatic)

1. **Normal** (recent GPU): PBR + environment reflections + MSAA, resolution ×1.5.
2. **Low-end** (Adreno ≤ 4xx, Mali-4xx/T6-7xx, PowerVR SGX…): no MSAA, resolution ×0.75, normals decompressed to float.
3. **Matcap** (if the test render of a metal sphere comes out black): automatic, whatever the GPU.

Force them for testing: `?aa=0|1`, `?pr=0.75`, `?dq=0|1`, `?fps=30` in the page URL.

## Still to check in the car

- FPS on the real head unit (`adb/probe.sh` or a `__scene.fps` measurement through `chrome://inspect`).
- Music metadata with a real player (Spotify / the unit's player).
- Where the stock launcher sits if the unit has several HOME activities (`--es launcher`).

## Startup intro (replaces the "W204" screen)

Front view in total darkness: only the **grille star** (dim) then the **two headlights** (projectors + LED signature) show.
Sequence: black → the star appears → the headlights flicker on (halo + flare) → gentle breathing → fade into the scene.
Images pre-rendered from the 3D model (`web/app/assets/intro_off.jpg` = star alone, `intro_on.jpg` = star + headlights,
~20 KB each): lit render with environment 0.008 and blacks crushed, star extracted from a lit render (circular mask, 55 %),
scaled to 84 % on black. Halos at 13 % / 87 %, 41.6 %. Minimum duration 1.7 s. Black native first frame.
