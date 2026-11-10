#!/bin/sh
# Usage: tools/glb/make.sh   (needs: python3 venv with pycollada numpy pillow ; npx @gltf-transform/cli@4)
set -e
HERE=$(cd "$(dirname "$0")" && pwd); ROOT="$HERE/../.."; V="$ROOT/Mercedes_W204/vehicles"; TMP="${TMPDIR:-/tmp}/w204glb"; mkdir -p "$TMP" "$ROOT/glb"
python3 -I "$HERE/load_dae.py" "$TMP/cache.pkl" "$V/c63w204kene/c63w204kene.dae" "$V/c63w204kene/c63w204kene_mechanical.dae" "$V/common/wheels/c63w204kene_wheels/c63w204kene_wheel.dae"
for c in black white; do
  python3 -I "$HERE/build.py" --cache "$TMP/cache.pkl" --root "$ROOT/Mercedes_W204" --paint $c --out "$TMP/raw_$c.glb"
  npx -y @gltf-transform/cli@4 optimize "$TMP/raw_$c.glb" "$ROOT/glb/w204_facelift_$c.glb" --compress meshopt --texture-compress webp --texture-size 1024 --flatten false --join false --instance false --palette false --simplify false
done
