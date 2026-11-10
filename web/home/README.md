# Home screen: startup sequence (prototype)

`index.html`: three.js scene, offline (vendor + GLB in `../probe/`). Open with `adb/probe.sh home` on the unit,
or locally through a static server pointed at `web/` → `http://localhost:<port>/home/`.

## States

| State | Visual | Trigger (CAN / OBD signal) |
| --- | --- | --- |
| `off` (contact off) | ¾ front view **nose to the right of the screen**, car on the turntable, lights off | `ACC = 0` |
| `acc` (contact on) | the car **wakes up**: **one hazard flash**, then **headlights on** (dipped + DRL + rear lights), then **one turntable turn** (3.9 s in total), back to ¾ front | `ACC 0 → 1`: ACC wire → MCU of the unit ✅ (the unit wakes with the contact) |
| `starting` | engine shake, dipped beam + rear lights, **half-turn**, plateau sinks, road appears, camera rises to an **overhead view** (3.45 s) | `engineOn`: "engine running" bit from the decoder if available 🔴, otherwise battery voltage > 13.2 V 🟡, otherwise first speed > 0 |
| `drive` | overhead view, nose up the screen, plunging view from behind (about 39°), car in the **centre lane of a motorway** (dashed lines left and right only). The lines **come from the top and go down** at the speed (always forward: reverse isn't handled because the gear engaged isn't reliable yet), wheels turn forward (clockwise seen from the right, anticlockwise from the left), brake lights on deceleration > 1.5 m/s² | speed via decoder (CAN-B) or speed pulse wire 🟡; real brake rarely available 🔴 |
| `stopping` | reverse of `starting`, back to `off` | `ACC → 0` (the unit then usually goes to sleep) |

Pressing "Start" from `off` chains `acc` then `starting`, which matches turning the key all the way in one go.

## Top of the screen: fade + tell-tales

In road mode, a gradient from the background colour (white by day, near black at night) to transparent covers the top
third of the screen: you can't see where the lines come from, and there is room for information.
Tell-tales shown there, like a cluster: left indicator · dipped beam (green) · main beam (blue) · fog lights · hazard (red) · right indicator.
Each icon has a fixed position and only shows when lit. Speed is shown large at the top left.

| Tell-tale | Source |
| --- | --- |
| Dipped / main beam / fog | lighting messages from the cluster, CAN-B 🟡 (fallback: lighting signal from the decoder box) |
| Indicators / hazard | CAN-B 🟡 |

## Day / night theme

| Theme | Background | Lines | Plateau |
| --- | --- | --- | --- |
| Night | `#0b0d10` (near black) | `#5d6670` (grey) | dark |
| Day | `#eef0f3` (white) | `#8e959e` (darker grey) | light |

`Auto` mode follows the system theme (`prefers-color-scheme`, i.e. the unit's day/night mode). On the unit, the
**lighting wire** (MCU) will drive it directly: more reliable than the system theme. The switch fades smoothly.
The "Theme" button cycles through auto → day → night.

## In the real app

- Replace the simulation buttons with the signals from the **decoder box / MCU** (no OBD, see `docs/donnees-decodeur.md`).
- **Render on demand**: only animate during sequences, while driving, and for lights/doors. Static in `off` → near-zero GPU load.
- The camera moves back automatically on narrow screens; in the final layout the car scene occupies the left part of the screen (doc §8.1).
- Animations follow the real clock: on a slow GPU the sequence keeps its duration, with fewer frames.
- Test hook: `window.__home.step(seconds, snap)` advances time without `requestAnimationFrame` (hidden tab, automated tests).
