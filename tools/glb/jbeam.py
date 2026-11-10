"""Tolerant jbeam (relaxed JSON) parser + part resolver for a .pc config."""
import json, re, os, glob


def _strip_comments(s):
    out, i, n, in_str = [], 0, len(s), False
    while i < n:
        c = s[i]
        if in_str:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(s[i + 1]); i += 2; continue
            if c == '"':
                in_str = False
            i += 1; continue
        if c == '"':
            in_str = True; out.append(c); i += 1; continue
        if s.startswith('//', i):
            j = s.find('\n', i); i = n if j < 0 else j; continue
        if s.startswith('/*', i):
            j = s.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        out.append(c); i += 1
    return ''.join(out)


def _tokens(s):
    tok = re.compile(r'\s*("(?:[^"\\]|\\.)*"|[\[\]{}:,]|[^\s\[\]{}:,"]+)', re.S)
    pos = 0
    while True:
        m = tok.match(s, pos)
        if not m:
            break
        pos = m.end()
        yield m.group(1)


def loads(text):
    toks = list(_tokens(_strip_comments(text)))
    # re-emit as strict JSON: insert commas between adjacent values, drop trailing commas
    out = []
    prev = None
    def is_val_end(t):
        return t not in ('[', '{', ':', ',') and t is not None
    def is_val_start(t):
        return t not in (']', '}', ':', ',')
    for t in toks:
        if t == ',' and prev in (',', '[', '{'):
            continue
        if t in (']', '}') and prev == ',':
            out.pop()
        elif is_val_end(prev) and is_val_start(t):
            out.append(',')
        if t not in ('[', ']', '{', '}', ':', ',') and not t.startswith('"'):
            low = t.lower()
            if low in ('true', 'false', 'null'):
                t = low
            else:
                try:
                    float(t)
                except ValueError:
                    t = json.dumps(t)
        out.append(t)
        prev = t
    return json.loads(''.join(out))


def load_parts(dirs):
    parts = {}
    for d in dirs:
        for f in glob.glob(os.path.join(d, '**', '*.jbeam'), recursive=True):
            try:
                data = loads(open(f, encoding='utf-8', errors='replace').read())
            except Exception as e:
                print('PARSE FAIL', f, e); continue
            for k, v in data.items():
                if isinstance(v, dict):
                    v['_file'] = f
                    parts[k] = v
    return parts


def slots_of(part):
    res = []
    for key in ('slots', 'slots2'):
        rows = part.get(key) or []
        if not rows:
            continue
        header = rows[0]
        for r in rows[1:]:
            if isinstance(r, list) and r:
                if key == 'slots':
                    res.append((r[0], r[1] if len(r) > 1 else ''))
                else:
                    h = {header[i]: r[i] for i in range(min(len(header), len(r)))}
                    res.append((h.get('name'), h.get('default', '')))
    return res


def flexbodies_of(part):
    rows = part.get('flexbodies') or []
    res = []
    for r in rows:
        if isinstance(r, list) and r and r[0] != 'mesh':
            extra = r[3] if len(r) > 3 and isinstance(r[3], dict) else {}
            res.append((r[0], extra))
    return res


def resolve(pc, parts):
    chosen = pc['parts']
    main = pc['mainPartName']
    used, meshes = [], []
    def walk(pname, depth=0):
        p = parts.get(pname)
        if p is None:
            used.append((depth, pname, 'MISSING')); return
        used.append((depth, pname, p.get('slotType')))
        for fb in flexbodies_of(p):
            meshes.append((pname,) + fb)
        for slot, default in slots_of(p):
            sel = chosen.get(slot, default)
            if sel:
                walk(sel, depth + 1)
    walk(main)
    return used, meshes
