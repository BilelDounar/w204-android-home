# W204 C 63 AMG facelift: GLB

Two models taken from the BeamNG `c63w204kene` mod, `c63amg_rest` config (facelift, late taillights).

| File | Paint | Size |
| --- | --- | --- |
| `w204_facelift_black.glb` | gloss black metallic + clearcoat | 3.4 MB |
| `w204_facelift_white.glb` | gloss white + clearcoat | 3.4 MB |
| `renders/w204_*_rear34.png` | rear ¾ view, transparent background (1134×629) | — |

About 267k triangles, 1024 px WebP textures, **meshopt** compression.
Units: metres. Y up, the car faces **+Z**, wheels sit on y = 0. **Lowered stance**: the body is 6.3 cm lower than in the mod: about 1 cm left between the arch and the top of the tyre (the tyre does not touch the arch).

## Loading (three.js)

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('w204_facelift_black.glb', g => scene.add(g.scene));
```

On Android, load the file in a WebView (three.js) or with SceneView/Filament. Filament needs the meshopt decoder too: if it isn't available, re-export without `--compress meshopt` (about 9 MB).

## Nodes (moving parts)

The pivot of each moving node is already on the hinge: you only need to rotate it.

Structure: `door_FL` (empty node = the hinge, carries the `extras`) → `door_FL_geo` (the mesh).
**Always rotate the parent node** (`door_FL`, `hood`, `trunk`, `wheel_*`), never the `_geo` child: the compression
(quantization) has moved the child's origin to the centre of the part.

| Node | `extras` | Rotation |
| --- | --- | --- |
| `door_FL`, `door_RL` | `type:"door"`, `hingeAxis:[0,1,0]`, `openSign:-1`, `openAngleDeg:65` | `rotateY(openSign · angle · t)` |
| `door_FR`, `door_RR` | same, `openSign:+1` | |
| `trunk` | `type:"trunk"`, `hingeAxis:[1,0,0]`, `openSign:+1`, `openAngleDeg:70` | `rotateX(…)` |
| `hood` | `type:"hood"`, `hingeAxis:[1,0,0]`, `openSign:-1`, `openAngleDeg:55` | `rotateX(…)` |
| `wheel_FL/FR/RL/RR` | `type:"wheel"`, `spinAxis:[1,0,0]`, `radius:0.33` | angle **+=** v / 0.33 · dt when moving forward (positive angle = top of the tyre towards the nose) |
| `body`, `brakes` | — | static (calipers do not spin) |

`t` runs from 0 (closed) to 1 (open). Mirrors and window glass belong to the doors.

Where the hinges are (computed from the geometry):
- **doors**: just ahead of the door's leading edge, on the outside of the skin, so the door swings outward without going into the fender;
- **hood**: at the foot of the windscreen. The cowl and wipers stay fixed;
- **trunk**: at the foot of the rear window.

The trunk is **debadged**: "C63" and "AMG" have been removed, the star stays.

## Lights (materials named `LIGHT_<function>__…`)

Each lamp has its own material, with `emissiveFactor = 0` (off) and a lit-zone mask in `emissiveTexture`.
`extras` contains:

- `light`: `brake`, `signal_L`, `signal_R`, `reverse`, `running` (DRL / rear running lights), `lowbeam`, `fog`
- `electrics`: the BeamNG logic, e.g. `{"lowhighbeam":0.49,"brakelights":1}` → intensity = max(signal × weight). The 0.49 weight gives the dim tail light, 1 gives full brake light.
- `emissiveOn` (normalised RGB) and `emissiveStrength`

```js
m.emissive.fromArray(m.userData.emissiveOn);
m.emissiveIntensity = intensity * Math.min(m.userData.emissiveStrength, 6);
```

How this maps to the CAN signals in the phase 2 doc (§8.1, zone 3): doors/trunk → door nodes, brake → `brakelights`,
reverse → `reverse`, turn signals/hazards → `signal_L` / `signal_R` (blinking is up to the app), dipped/main beam → `lowbeam` / `highbeam` + `lowhighbeam`.

## Not included / limits

- Brake discs and license plates are base BeamNG assets missing from the mod (the calipers are there).
- The `doorpanel_*_rest` and `dash_rest` meshes don't exist in the DAE: the pre-facelift versions are used instead (interior only).
  The right-hand door cards are mis-placed in the mod's DAE: they are replaced by the left ones, mirrored.
- The trunk spoiler (`c63w204kene_lip`) is attached to the `trunk` node.
- Engine, trunk floor and suspension were removed to keep the file light. In their place, the engine bay and the trunk are
  **flat matte black tubs** (`bay_black` material, no reflections). The tubs follow the body shape: narrower between the headlights and
  between the taillights, and they stop before the cowl.
- **Licence**: the model is a reupload of Kenemation's mod. Fine for your personal head unit; do not redistribute or publish in an app without the author's permission.

## Regenerating

The scripts are in `tools/glb/` (Python + pycollada, then `gltf-transform optimize … --simplify false`).
Do not enable `--simplify`: it leaves patches on the paint.
