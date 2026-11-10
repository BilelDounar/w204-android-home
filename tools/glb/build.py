"""Build W204 facelift GLB (paint colour as arg) from cached DAE meshes + BeamNG jbeam/materials."""
import sys, os, json, glob, pickle, io, struct, re, argparse
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import jbeam

ap = argparse.ArgumentParser()
ap.add_argument('--cache', required=True)
ap.add_argument('--root', required=True)          # .../Mercedes_W204
ap.add_argument('--config', default='c63amg_rest')
ap.add_argument('--paint', required=True)         # black | white
ap.add_argument('--out', required=True)
ap.add_argument('--tex', type=int, default=1024)
ap.add_argument('--tex-small', type=int, default=512)
args = ap.parse_args()

ROOT = args.root
V = os.path.join(ROOT, 'vehicles')
VEH = os.path.join(V, 'c63w204kene')

PAINTS = {
    'black': dict(base=[0.012, 0.012, 0.014, 1], metallic=0.55, roughness=0.32, cc=1.0, ccr=0.04),
    'white': dict(base=[0.86, 0.87, 0.87, 1], metallic=0.0, roughness=0.34, cc=1.0, ccr=0.04),
}
PAINT = PAINTS[args.paint]

# ---------------------------------------------------------------- jbeam
parts = jbeam.load_parts([VEH, os.path.join(V, 'common')])
pc = json.load(open(os.path.join(VEH, args.config + '.pc')))
used, flex = jbeam.resolve(pc, parts)
used_names = [u[1] for u in used if u[2] != 'MISSING']
glowmap = {}
props = []
for pn in used_names:
    p = parts[pn]
    for k, v in (p.get('glowMap') or {}).items():
        glowmap[k] = v
    rows = p.get('props') or []
    for r in rows[1:] if rows else []:
        if isinstance(r, list) and len(r) > 1 and isinstance(r[1], str):
            props.append(r[1])

# ---------------------------------------------------------------- meshes
cache = pickle.load(open(args.cache, 'rb'))
allm = {}
for f, d in cache.items():
    for k, v in d.items():
        allm.setdefault(k, v)

DROP = re.compile(r'(engine_v8|enginev8|header_v8|transmission|fueltank|_diff|heatshield|subframe|steeringbox|tierod|lowerarm|upperarm|swaybar|spring_|shock_|strut_|_dmg|enginebay|trunkbay|halfshaft|exhaust_[LR]$|underbody_cladding|fenderbadge)')

def find_mesh(name):
    for cand in (name, name.replace('_rest', ''), name.replace('_rest', '').replace('_sedan', '')):
        if cand in allm:
            return cand
    return None

# group assignment (node name -> list of meshes)
def group_of(m):
    for side in ('FL', 'FR', 'RL', 'RR'):
        if re.search(rf'_(door|doorpart|doorpanel|doorglass)_{side}', m):
            return 'door_' + side
    if re.search(r'_mirror_L', m): return 'door_FL'
    if re.search(r'_mirror_R', m): return 'door_FR'
    if re.search(r'_hood|_hoodlogo', m): return 'hood'
    if re.search(r'_trunk_sedan|_trunkpart|_lettering$|^c63w204kene_lip(_507|_tuning)?$', m): return 'trunk'  # lip = trunk-lid spoiler
    return 'body'

instances = []  # (group, mesh, matrix4 beam-space)
seen = set()
missing = []
for pname, mesh, extra in flex:
    is_wheelish = mesh.startswith(('c63w204kene_wheel', 'tire_', 'brake_'))
    if is_wheelish:
        continue
    mm = find_mesh(mesh)
    if mm is None:
        missing.append(mesh); continue
    if DROP.search(mm) or mm in seen:
        continue
    seen.add(mm)
    # right-hand door cards are mis-placed in the source DAE: use the left ones mirrored (x -> -x)
    mr = re.match(r'c63w204kene_doorpanel_(F|R)R$', mm)
    if mr and find_mesh(f'c63w204kene_doorpanel_{mr.group(1)}L'):
        instances.append((group_of(mm), find_mesh(f'c63w204kene_doorpanel_{mr.group(1)}L'), np.diag([-1.0, 1, 1, 1])))
        continue
    instances.append((group_of(mm), mm, np.eye(4)))
for pr in props:
    if 'steer' in pr:
        mm = find_mesh(pr)
        if mm and mm not in seen:
            seen.add(mm); instances.append(('body', mm, np.eye(4)))
print('missing meshes (base game / absent):', sorted(set(missing)))

# ---------------------------------------------------------------- wheels
def rot_xyz(rx, ry, rz):
    rx, ry, rz = np.radians([rx, ry, rz])
    X = np.array([[1, 0, 0], [0, np.cos(rx), -np.sin(rx)], [0, np.sin(rx), np.cos(rx)]])
    Y = np.array([[np.cos(ry), 0, np.sin(ry)], [0, 1, 0], [-np.sin(ry), 0, np.cos(ry)]])
    Z = np.array([[np.cos(rz), -np.sin(rz), 0], [np.sin(rz), np.cos(rz), 0], [0, 0, 1]])
    return Z @ Y @ X

def trs(pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    m = np.eye(4)
    m[:3, :3] = rot_xyz(*rot) @ np.diag(scale)
    m[:3, 3] = pos
    return m

AXLE = {'F': dict(y=-1.40, x=0.770, z=0.33), 'R': dict(y=1.295, x=0.765, z=0.33)}
GROUND_FIX = 0.33 - 0.328 * 0.984   # tyre real radius 0.322 -> lower everything so the tyres touch y = 0
wheel_mesh = find_mesh('c63w204kene_wheel_alt')
tire_mesh = find_mesh('tire_01a_19x9_26_michelin')
tire_scale = {'F': (1.05, 0.983, 0.985), 'R': (1.05, 0.983, 0.983)}
wheel_centers = {}
for ax in ('F', 'R'):
    a = AXLE[ax]
    for side, sx, rz in (('L', 1, 0), ('R', -1, 180)):
        g = f'wheel_{ax}{side}'
        c = np.array([sx * a['x'], a['y'], a['z']])
        wheel_centers[g] = c
        instances.append((g, wheel_mesh, trs((0, 0, 0), (0, 0, rz))))
        instances.append((g, tire_mesh, trs((0, 0, 0), (0, 0, rz), tire_scale[ax])))
        cal = 'brake_caliper_6pot_red_amg' if ax == 'F' else 'brake_caliper_4pot_red_amg'
        cm = find_mesh(cal)
        if cm:
            # caliper: static (does not spin) -> body group, behind the axle, inboard of the rim
            m = trs(c + np.array([-sx * 0.035, 0, 0]), (0, 0, rz), (1.0, 1.21 if ax == 'F' else 1.05, 1.21 if ax == 'F' else 1.05))
            instances.append(('brakes', cm, m))

# ---------------------------------------------------------------- materials
mats = {}
for f in glob.glob(os.path.join(V, '**', '*.materials.json'), recursive=True):
    try:
        d = json.load(open(f))
    except Exception:
        d = jbeam.loads(open(f).read())
    for k, v in d.items():
        if isinstance(v, dict):
            mats.setdefault(v.get('mapTo', k), v)
            mats.setdefault(k, v)

def stage0(m):
    st = (m.get('Stages') or [{}])
    s = dict(st[0]) if st else {}
    for k, v in m.items():
        if k != 'Stages' and k not in s:
            s[k] = v
    return s, st

LIGHT_FUNC = [
    (r'signal_L', 'signal_L'), (r'signal_R', 'signal_R'), (r'_stop', 'brake'), (r'reverse', 'reverse'),
    (r'running', 'running'), (r'dxo|drl', 'drl'), (r'lowhighbeam|lowbeam', 'lowbeam'), (r'highbeam', 'highbeam'),
    (r'fog', 'fog'), (r'chmsl', 'brake'),
]

def light_func(name):
    for pat, fn in LIGHT_FUNC:
        if re.search(pat, name, re.I):
            return fn
    return None

TEXCACHE = {}
def resolve_tex(path):
    if not path:
        return None
    p = path.lstrip('/')
    base = os.path.join(ROOT, p)
    stem, ext = os.path.splitext(base)
    cands = [base, stem + '.dds', stem + '.DDS', stem + '.png', stem + '.jpg']
    if stem.endswith(('.color', '.data', '.normal')):
        s2 = stem.rsplit('.', 1)[0]
        cands += [s2 + '.dds', s2 + '.png']
    for c in cands:
        if os.path.isfile(c):
            return c
    d, b = os.path.split(base)
    if os.path.isdir(d):
        low = {x.lower(): x for x in os.listdir(d)}
        for c in cands:
            bb = os.path.basename(c).lower()
            if bb in low:
                return os.path.join(d, low[bb])
    return None

images = []    # (bytes, mime)
textures = []
tex_index = {}
def add_texture(path, kind, size):
    """kind: color | normal | data | orm ; returns texture index or None"""
    key = (path, kind, size)
    if key in tex_index:
        return tex_index[key]
    try:
        im = Image.open(path)
        im.load()
    except Exception as e:
        print('  TEX FAIL', os.path.basename(path), e)
        tex_index[key] = None
        return None
    has_alpha = im.mode in ('RGBA', 'LA') or 'transparency' in im.info
    if has_alpha:
        im = im.convert('RGBA')
        if np.asarray(im)[..., 3].min() > 250:
            im = im.convert('RGB'); has_alpha = False
    else:
        im = im.convert('RGB')
    w, h = im.size
    s = min(1.0, size / max(w, h))
    if s < 1:
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    buf = io.BytesIO()
    if has_alpha or kind == 'normal':
        im.save(buf, 'PNG', optimize=True); mime = 'image/png'
    else:
        im.save(buf, 'JPEG', quality=88); mime = 'image/jpeg'
    images.append((buf.getvalue(), mime))
    textures.append({'source': len(images) - 1, 'sampler': 0})
    tex_index[key] = len(textures) - 1
    return tex_index[key]

def orm_texture(rough_p, metal_p, size):
    key = ('orm', rough_p, metal_p, size)
    if key in tex_index:
        return tex_index[key]
    def ld(p):
        if not p: return None
        try:
            im = Image.open(p); im.load(); return im.convert('L')
        except Exception as e:
            print('  TEX FAIL', p, e); return None
    r, m = ld(rough_p), ld(metal_p)
    if r is None and m is None:
        tex_index[key] = None; return None
    ref = r or m
    w, h = ref.size
    s = min(1.0, size / max(w, h)); tw, th = max(1, int(w * s)), max(1, int(h * s))
    R = (r.resize((tw, th)) if r else Image.new('L', (tw, th), 255))
    M = (m.resize((tw, th)) if m else Image.new('L', (tw, th), 255))
    im = Image.merge('RGB', (Image.new('L', (tw, th), 255), R, M))
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=90)
    images.append((buf.getvalue(), 'image/jpeg'))
    textures.append({'source': len(images) - 1, 'sampler': 0})
    tex_index[key] = len(textures) - 1
    return tex_index[key]

gl_materials = []
mat_index = {}
interior_only = set()

def build_material(name, small):
    key = (name, small)
    if key in mat_index:
        return mat_index[key]
    size = args.tex_small if small else args.tex
    fn = None
    funcs = None
    gm = glowmap.get(name)
    look = name
    on_mat = None
    if gm:
        look = gm.get('off', name)
        sf = gm.get('simpleFunction')
        if isinstance(sf, dict):          # exterior lamp driven by vehicle electrics
            on_mat = mats.get(gm.get('on'))
            funcs = {k: float(v) for k, v in sf.items()}
            k = set(funcs)
            fn = ('brake' if 'brakelights' in k else 'signal_L' if any(x.startswith('signal_L') for x in k)
                  else 'signal_R' if any(x.startswith('signal_R') for x in k) else 'reverse' if 'reverse' in k
                  else 'fog' if 'fog' in k else 'running' if 'running' in k
                  else 'lowbeam' if 'lowbeam' in k else 'highbeam' if 'highbeam' in k else 'position')
    src = mats.get(look) or mats.get(name)
    out = {'name': name, 'pbrMetallicRoughness': {'metallicFactor': 0.0, 'roughnessFactor': 0.6}}
    pbr = out['pbrMetallicRoughness']
    extras = {}
    if name == 'bay_black':
        pbr.update(baseColorFactor=[0.008, 0.008, 0.009, 1], metallicFactor=0.0, roughnessFactor=1.0)
        out['doubleSided'] = True
        out['extensions'] = {'KHR_materials_specular': {'specularFactor': 0.0}}   # no env reflections: flat black
    elif name in ('glass_invisible',):
        out.update(alphaMode='BLEND'); pbr['baseColorFactor'] = [1, 1, 1, 0]
    elif src is None:
        pbr['baseColorFactor'] = [0.05, 0.05, 0.05, 1]
        if name == 'mirror':
            pbr.update(baseColorFactor=[0.9, 0.9, 0.9, 1], metallicFactor=1.0, roughnessFactor=0.02)
        extras['unresolved'] = True
    else:
        s, stages = stage0(src)
        is_paint = 'paint' in look.lower() and 'paint' in (src.get('name', '') + look).lower()
        is_paint = is_paint or any(isinstance(st, dict) and st.get('instanceDiffuse') for st in stages)
        if is_paint:
            pbr.update(baseColorFactor=PAINT['base'], metallicFactor=PAINT['metallic'], roughnessFactor=PAINT['roughness'])
            out.setdefault('extensions', {})['KHR_materials_clearcoat'] = {'clearcoatFactor': PAINT['cc'], 'clearcoatRoughnessFactor': PAINT['ccr']}
            ao = resolve_tex(s.get('ambientOcclusionMap'))
            if ao:
                t = add_texture(ao, 'data', size)
                if t is not None:
                    out['occlusionTexture'] = {'index': t, 'texCoord': 1, 'strength': 1.0}
            extras['paint'] = True
        else:
            bc = s.get('baseColorFactor') or s.get('diffuseColor')
            if bc:
                pbr['baseColorFactor'] = [float(x) for x in bc[:4]] + ([1.0] * (4 - len(bc[:4])))
            cm = resolve_tex(s.get('baseColorMap') or s.get('colorMap') or s.get('diffuseMap'))
            if cm:
                t = add_texture(cm, 'color', size)
                if t is not None:
                    pbr['baseColorTexture'] = {'index': t}
            if s.get('metallicFactor') is not None:
                pbr['metallicFactor'] = float(s['metallicFactor'])
            if s.get('roughnessFactor') is not None:
                pbr['roughnessFactor'] = float(s['roughnessFactor'])
            rm, mm = resolve_tex(s.get('roughnessMap')), resolve_tex(s.get('metallicMap'))
            if rm or mm:
                t = orm_texture(rm, mm, size)
                if t is not None:
                    pbr['metallicRoughnessTexture'] = {'index': t}
                    if not mm: pbr['metallicFactor'] = 0.0
                    if not rm and s.get('roughnessFactor') is None: pbr['roughnessFactor'] = 0.5
            nm = resolve_tex(s.get('normalMap'))
            if nm and not small:
                t = add_texture(nm, 'normal', min(size, 1024))
                if t is not None:
                    out['normalTexture'] = {'index': t}
            if s.get('clearCoatFactor'):
                out.setdefault('extensions', {})['KHR_materials_clearcoat'] = {'clearcoatFactor': float(s['clearCoatFactor']), 'clearcoatRoughnessFactor': float(s.get('clearCoatRoughnessFactor') or 0)}
            if src.get('translucent') or s.get('opacityFactor') is not None and float(s.get('opacityFactor') or 1) < 1:
                out['alphaMode'] = 'BLEND'
                op = s.get('opacityFactor')
                if op is not None:
                    pbr['baseColorFactor'] = (pbr.get('baseColorFactor') or [1, 1, 1, 1])[:3] + [max(0.08, float(op))]
                if 'glass' in look.lower():
                    pbr['roughnessFactor'] = 0.02; pbr['metallicFactor'] = 0.0
                    bc = pbr.get('baseColorFactor', [0.1, 0.1, 0.1, 0.25])
                    pbr['baseColorFactor'] = bc[:3] + [max(bc[3], 0.18)]
            elif src.get('alphaTest') or s.get('alphaTest'):
                out['alphaMode'] = 'MASK'
                out['alphaCutoff'] = float(src.get('alphaRef', s.get('alphaRef', 127)) or 127) / 255.0
            if src.get('doubleSided') or s.get('doubleSided') or out.get('alphaMode') == 'BLEND':
                out['doubleSided'] = True
    if fn:
        extras['light'] = fn
        if funcs:
            # intensity = max over (electrics[key] * weight); 0.49 = dim (tail/position), 1 / 100 = full
            extras['electrics'] = {k: min(v, 1.0) for k, v in funcs.items()}
        out['emissiveFactor'] = [0, 0, 0]
        if on_mat:
            so, _ = stage0(on_mat)
            ef = so.get('emissiveFactor') or [1, 1, 1]
            mx = max(max(ef[:3]), 1e-6)
            extras['emissiveOn'] = [round(x / mx, 4) for x in ef[:3]]
            extras['emissiveStrength'] = round(mx, 3)
            em = resolve_tex(so.get('emissiveMap'))
            if em:
                t = add_texture(em, 'color', size)
                if t is not None:
                    out['emissiveTexture'] = {'index': t}
        else:
            default = {'brake': [1, 0, 0], 'signal_L': [1, 0.45, 0], 'signal_R': [1, 0.45, 0], 'reverse': [1, 1, 1], 'running': [1, 0, 0]}
            extras['emissiveOn'] = default.get(fn, [1, 1, 1]); extras['emissiveStrength'] = 4.0
        out['name'] = f'LIGHT_{fn}__{name}'
    if extras:
        out['extras'] = extras
    gl_materials.append(out)
    mat_index[key] = len(gl_materials) - 1
    return mat_index[key]

# ---------------------------------------------------------------- geometry
def to_gl(p):  # beam (x,y,z) z-up, -y forward  ->  gl (x, z, -y) y-up, car faces +Z
    return np.stack([p[:, 0], p[:, 2], -p[:, 1]], 1)

def debadge(pr):
    """Trunk lettering mesh holds 'C63' (x<-0.2), the star (centre) and 'AMG' (x>0.2): keep only the star."""
    keep = np.abs(pr['pos'].reshape(-1, 3, 3).mean(1)[:, 0]) < 0.2
    m = np.repeat(keep, 3)
    return {k: (v[m] if isinstance(v, np.ndarray) and len(v) == len(pr['pos']) else v) for k, v in pr.items()}

groups = {}
for g, mesh, M in instances:
    for pr in allm[mesh]:
        if mesh == 'c63w204kene_lettering':
            pr = debadge(pr)
        pos = pr['pos']
        P = np.c_[pos, np.ones(len(pos))] @ M.T
        P = P[:, :3]
        N = pr['nrm']
        if N is not None:
            N = N @ np.linalg.inv(M[:3, :3]).T.T
            N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
        flip = bool(pr['flip']) ^ (np.linalg.det(M[:3, :3]) < 0)
        groups.setdefault(g, []).append(dict(mesh=mesh, mat=pr['mat'], pos=P, nrm=N, uv=pr['uv'], uv1=pr.get('uv1'), flip=flip))

# ---- simple matte-black tubs that hide the empty engine bay and trunk (beam coords, open top)
def tub(x0, x1, y0, y1, zf, zt0, zt1):
    """floor + 4 walls; wall top goes from zt0 at y0 to zt1 at y1"""
    zt = lambda y: zt0 + (zt1 - zt0) * (y - y0) / (y1 - y0)
    q = []
    q.append([(x0, y0, zf), (x1, y0, zf), (x1, y1, zf), (x0, y1, zf)])                      # floor
    q.append([(x0, y0, zf), (x0, y1, zf), (x0, y1, zt(y1)), (x0, y0, zt(y0))])              # side
    q.append([(x1, y0, zf), (x1, y0, zt(y0)), (x1, y1, zt(y1)), (x1, y1, zf)])              # side
    q.append([(x0, y0, zf), (x0, y0, zt(y0)), (x1, y0, zt(y0)), (x1, y0, zf)])              # front
    q.append([(x0, y1, zf), (x1, y1, zf), (x1, y1, zt(y1)), (x0, y1, zt(y1))])              # back
    P, N = [], []
    for a, b, c, d in q:
        a, b, c, d = map(np.array, (a, b, c, d))
        n = np.cross(b - a, c - a); n = n / np.linalg.norm(n)
        P += [a, b, c, a, c, d]; N += [n] * 6
    return dict(mesh='bay_tub', mat='bay_black', pos=np.array(P, np.float32), nrm=np.array(N, np.float32), uv=None, uv1=None, flip=False)

def tub_poly(foot, zf, zt):
    """open-top tub on a star-shaped footprint [(x,y),...] (CCW seen from above); zt(y) = wall top height"""
    foot = [np.array(p, float) for p in foot]
    c = np.mean(foot, 0)
    P, N = [], []
    def tri(a, b, cc):
        n = np.cross(b - a, cc - a); n = n / np.linalg.norm(n); P.extend([a, b, cc]); N.extend([n] * 3)
    for i in range(len(foot)):
        a, b = foot[i], foot[(i + 1) % len(foot)]
        tri(np.r_[c, zf], np.r_[a, zf], np.r_[b, zf])                                   # floor (fan)
        A0, B0, A1, B1 = np.r_[a, zf], np.r_[b, zf], np.r_[a, zt(a[1])], np.r_[b, zt(b[1])]
        tri(A0, B1, B0); tri(A0, A1, B1)                                                 # wall
    return dict(mesh='bay_tub', mat='bay_black', pos=np.array(P, np.float32), nrm=np.array(N, np.float32), uv=None, uv1=None, flip=False)

def mirror_foot(half):  # half = right side points (x>=0) from front to back -> full CCW loop
    return [(x, y) for x, y in half] + [(-x, y) for x, y in reversed(half)]

# engine bay: narrow between the headlight housings (they start at |x|=0.42, y<-1.72)
# stops before the cowl (hood rear edge y≈-1.0 on the centreline, windscreen foot y=-0.85)
ENGINE_FOOT = mirror_foot([(0.38, -1.90), (0.38, -1.70), (0.70, -1.64), (0.70, -1.02)])
ENGINE_TOP = lambda y: 0.66 + (0.88 - 0.66) * (y + 1.90) / (1.90 - 1.02)
# trunk: narrow between the taillights (they start at |x|=0.44, y>1.88, z 0.73-0.96)
TRUNK_FOOT = mirror_foot([(0.60, 1.42), (0.60, 1.82), (0.41, 1.87), (0.41, 2.17)])
groups.setdefault('body', []).append(tub_poly(ENGINE_FOOT, 0.42, ENGINE_TOP))
groups['body'].append(tub_poly(TRUNK_FOOT, 0.62, lambda y: 0.93))

# everything of the body shell that sits inside the bay / trunk volumes -> matte black
KEEP_LOOK = re.compile(r'headlight|taillight|grille|bumper|fender|lip|exhaust|brake|caliper|steer|seat|interior|dash')
VOLUMES = [((-0.76, 0.76), (-1.97, -1.70), (0.0, 0.96)),    # engine bay front corners (headlights/fenders are separate meshes, untouched)
           ((-0.76, 0.76), (-1.70, -1.00), (0.0, 0.97)),    # engine bay, behind headlights (not the cowl)
           ((-0.62, 0.62), (1.40, 1.84), (0.0, 0.96)),      # trunk, ahead of taillights
           ((-0.42, 0.42), (1.84, 2.20), (0.0, 0.96))]      # trunk, between taillights
newbody = []
for it in groups['body']:
    if it['mesh'] == 'bay_tub' or KEEP_LOOK.search(it['mesh']):
        newbody.append(it); continue
    c = it['pos'].reshape(-1, 3, 3).mean(1)
    inside = np.zeros(len(c), bool)
    for (x0, x1), (y0, y1), (z0, z1) in VOLUMES:
        inside |= (c[:, 0] > x0) & (c[:, 0] < x1) & (c[:, 1] > y0) & (c[:, 1] < y1) & (c[:, 2] > z0) & (c[:, 2] < z1)
    if not inside.any():
        newbody.append(it); continue
    m = np.repeat(inside, 3)
    sub = lambda mm: {k: (v[mm] if isinstance(v, np.ndarray) and len(v) == len(it['pos']) else v) for k, v in it.items()}
    blk = sub(m); blk['mat'] = 'bay_black'; blk['uv'] = None; blk['uv1'] = None
    newbody.append(blk)
    if (~m).any():
        newbody.append(sub(~m))
groups['body'] = newbody

INTERIOR = re.compile(r'interior|seat|dash|decals_gauges|steer|kovriki|doorpanel|_int$|sunroof_int|gauges')

# pivots in beam space
def bbox(items):
    P = np.concatenate([i['pos'] for i in items]); return P.min(0), P.max(0)

def glass_edge(mesh, front):
    G = np.concatenate([p['pos'] for p in allm[mesh]])
    G = G[np.abs(G[:, 0]) < 0.15]
    i = G[:, 1].argmin() if front else G[:, 1].argmax()
    return G[i]

pivots = {}
for g, items in groups.items():
    lo, hi = bbox(items)
    if g.startswith('door_'):
        side = 1 if g in ('door_FL', 'door_RL') else -1
        # hinge just ahead of the door's leading edge and just outside its outermost skin,
        # so the door swings outward instead of into the fender / B-pillar
        skin = np.concatenate([i['pos'] for i in items if re.search(r'_door_|_doorpart_', i['mesh']) and 'paint' in str(i['mat'])])
        x = side * (np.abs(skin[:, 0]).max() + 0.01)
        pivots[g] = np.array([x, skin[:, 1].min() - 0.01, (skin[:, 2].min() + skin[:, 2].max()) / 2])
    elif g == 'hood':
        ws = glass_edge('c63w204kene_windshield', front=True)      # foot of the windscreen
        pivots[g] = np.array([0, ws[1], ws[2] - 0.005])
    elif g == 'trunk':
        rg = glass_edge('c63w204kene_rearglass_sedan', front=False)  # foot of the rear window
        pivots[g] = np.array([0, rg[1], rg[2] - 0.005])
    elif g.startswith('wheel_'):
        pivots[g] = wheel_centers[g]                                # meshes are authored at the origin
    else:
        pivots[g] = np.zeros(3)

# cowl / wiper area authored inside the hood mesh but behind the windscreen foot: keep it on the body
if 'hood' in groups:
    cut = pivots['hood'][1] + 0.01
    keep_items = []
    for it in groups['hood']:
        cy = it['pos'].reshape(-1, 3, 3).mean(1)[:, 1]
        back = np.repeat(cy > cut, 3)
        if back.any():
            sub = lambda m: {k: (v[m] if isinstance(v, np.ndarray) and len(v) == len(it['pos']) else v) for k, v in it.items()}
            groups['body'].append(sub(back))
            if (~back).any():
                keep_items.append(sub(~back))
        else:
            keep_items.append(it)
    groups['hood'] = keep_items

# lowered stance: body and all opening panels drop RIDE_DROP metres, wheels and calipers stay
# (stock arch gap above the tyres is ~6.5 cm front and rear)
RIDE_DROP = 0.063   # user asked 1 cm below the concentric stance (≈0.5-1 cm left at the top of the arch)
for g, items in groups.items():
    if g.startswith('wheel_') or g == 'brakes':
        continue
    for it in items:
        it['pos'] = it['pos'] - np.array([0, 0, RIDE_DROP], np.float32)
    pivots[g] = pivots[g] - np.array([0, 0, RIDE_DROP])
for g, items in groups.items():           # whole car (wheels included) down so the tyres sit on the ground
    if not g.startswith('wheel_'):        # wheel meshes are authored around their own centre: only move their pivot
        for it in items:
            it['pos'] = it['pos'] - np.array([0, 0, GROUND_FIX], np.float32)
    pivots[g] = pivots[g] - np.array([0, 0, GROUND_FIX])

bin_chunks = []
def add_buf(arr, target=None):
    data = arr.tobytes()
    off = sum(len(b) for b in bin_chunks)
    pad = (-off) % 4
    if pad:
        bin_chunks.append(b'\0' * pad); off += pad
    bin_chunks.append(data)
    bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if target: bv['target'] = target
    bufferViews.append(bv)
    return len(bufferViews) - 1

bufferViews, accessors, meshes, nodes = [], [], [], []
def add_acc(arr, typ, comp, target, minmax=False):
    bv = add_buf(arr, target)
    a = {'bufferView': bv, 'componentType': comp, 'count': len(arr), 'type': typ}
    if minmax:
        a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accessors.append(a); return len(accessors) - 1

total_tris = 0
child_nodes = []
GROUP_ORDER = ['body', 'brakes', 'hood', 'trunk', 'door_FL', 'door_FR', 'door_RL', 'door_RR', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']
for g in GROUP_ORDER:
    if g not in groups:
        continue
    items = groups[g]
    piv = pivots[g]
    is_wheel = g.startswith('wheel_')
    bymat = {}
    for it in items:
        g_ = glowmap.get(it['mat'])
        if g_ and g_.get('off') == 'invis':   # cluster tell-tales: invisible when off
            continue
        small = bool(INTERIOR.search(it['mesh']))
        bymat.setdefault((it['mat'], small), []).append(it)
    prims = []
    for (mname, small), its in bymat.items():
        P, N, U, U1 = [], [], [], []
        has_n = all(i['nrm'] is not None for i in its)
        has_u = all(i['uv'] is not None for i in its)
        has_u1 = all(i['uv1'] is not None for i in its)
        for i in its:
            p = i['pos'] - (0 if is_wheel else piv)
            n, u, u1 = i['nrm'], i['uv'], i['uv1']
            if i['flip']:
                idx = np.arange(len(p)).reshape(-1, 3)[:, ::-1].reshape(-1)
                p = p[idx]; n = n[idx] if n is not None else None
                u = u[idx] if u is not None else None; u1 = u1[idx] if u1 is not None else None
            P.append(p)
            if has_n: N.append(n)
            if has_u: U.append(u)
            if has_u1: U1.append(u1)
        P = to_gl(np.concatenate(P)).astype(np.float32)
        cols = [P]
        if has_n:
            N = to_gl(np.concatenate(N)).astype(np.float32); cols.append(N)
        if has_u:
            U = np.concatenate(U).astype(np.float32).copy(); U[:, 1] = 1 - U[:, 1]; cols.append(U)
        if has_u1:
            U1 = np.concatenate(U1).astype(np.float32).copy(); U1[:, 1] = 1 - U1[:, 1]; cols.append(U1)
        allv = np.concatenate(cols, 1)
        q = np.round(allv * 1e5).astype(np.int64)
        _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
        verts = allv[first]
        idx = inv.reshape(-1).astype(np.uint32)
        total_tris += len(idx) // 3
        off = 0
        attrs = {}
        attrs['POSITION'] = add_acc(np.ascontiguousarray(verts[:, 0:3]), 'VEC3', 5126, 34962, True); off = 3
        if has_n:
            attrs['NORMAL'] = add_acc(np.ascontiguousarray(verts[:, off:off + 3]), 'VEC3', 5126, 34962); off += 3
        if has_u:
            attrs['TEXCOORD_0'] = add_acc(np.ascontiguousarray(verts[:, off:off + 2]), 'VEC2', 5126, 34962); off += 2
        if has_u1:
            attrs['TEXCOORD_1'] = add_acc(np.ascontiguousarray(verts[:, off:off + 2]), 'VEC2', 5126, 34962); off += 2
        mi = build_material(mname, small)
        if 'occlusionTexture' in gl_materials[mi] and 'TEXCOORD_1' not in attrs:
            gl_materials[mi]['occlusionTexture']['texCoord'] = 0 if False else gl_materials[mi]['occlusionTexture']['texCoord']
        ii = add_acc(idx, 'SCALAR', 5125, 34963)
        prims.append({'attributes': attrs, 'indices': ii, 'material': mi})
    meshes.append({'name': g, 'primitives': prims})
    # The geometry lives in a child node: mesh quantization (meshopt) rewrites the transform of the node
    # that holds the mesh (moves its origin to the mesh bbox centre). The parent stays clean = the hinge.
    nodes.append({'name': g + '_geo', 'mesh': len(meshes) - 1})
    node = {'name': g, 'children': [len(nodes) - 1]}
    t = to_gl(piv[None, :])[0]
    if np.any(t != 0):
        node['translation'] = [float(x) for x in t]
    extras = {}
    if g.startswith('door_'):
        extras = {'type': 'door', 'hingeAxis': [0, 1, 0], 'openSign': (-1 if g in ('door_FL', 'door_RL') else 1), 'openAngleDeg': 65}
    elif g == 'hood':
        extras = {'type': 'hood', 'hingeAxis': [1, 0, 0], 'openSign': -1, 'openAngleDeg': 55}
    elif g == 'trunk':
        extras = {'type': 'trunk', 'hingeAxis': [1, 0, 0], 'openSign': 1, 'openAngleDeg': 70}
    elif is_wheel:
        extras = {'type': 'wheel', 'spinAxis': [1, 0, 0], 'radius': 0.33}
    if extras:
        node['extras'] = extras
    nodes.append(node)
    child_nodes.append(len(nodes) - 1)

nodes.append({'name': 'W204_C63_facelift_' + args.paint, 'children': child_nodes})

# any primitive referencing occlusion uv1 without TEXCOORD_1 -> drop occlusion on that material use (keep simple: check)
for m in meshes:
    for p in m['primitives']:
        mat = gl_materials[p['material']]
        if 'occlusionTexture' in mat and mat['occlusionTexture'].get('texCoord') == 1 and 'TEXCOORD_1' not in p['attributes']:
            mat['occlusionTexture']['texCoord'] = 0

# images
for data, mime in images:
    bv = add_buf(np.frombuffer(data, np.uint8))
    pass
img_bv_start = len(bufferViews) - len(images)
gl_images = [{'bufferView': img_bv_start + i, 'mimeType': images[i][1]} for i in range(len(images))]

ext_used = sorted({k for m in gl_materials for k in (m.get('extensions') or {})})
gltf = {
    'asset': {'version': '2.0', 'generator': 'w204 beamng->glb (claude)', 'extras': {'config': args.config, 'paint': args.paint, 'source': 'BeamNG mod c63w204kene (Kenemation) — personal use'}},
    'scene': 0, 'scenes': [{'nodes': [len(nodes) - 1]}], 'nodes': nodes, 'meshes': meshes,
    'materials': gl_materials, 'accessors': accessors, 'bufferViews': bufferViews,
    'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
    'textures': textures, 'images': gl_images,
    'buffers': [{'byteLength': sum(len(b) for b in bin_chunks)}],
}
if ext_used:
    gltf['extensionsUsed'] = ext_used
js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * ((-len(js)) % 4)
binb = b''.join(bin_chunks); binb += b'\0' * ((-len(binb)) % 4)
gltf['buffers'][0]['byteLength'] = len(binb)
js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
with open(args.out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(binb), 0x004E4942)); f.write(binb)
print(f'{args.out}: {os.path.getsize(args.out)/1e6:.1f} MB, {total_tris} tris, {len(gl_materials)} mats, {len(images)} images')
print('lights:', sorted({(m["extras"]["light"], m["name"]) for m in gl_materials if m.get("extras", {}).get("light")}))
print('unresolved mats:', [m['name'] for m in gl_materials if m.get('extras', {}).get('unresolved')])
