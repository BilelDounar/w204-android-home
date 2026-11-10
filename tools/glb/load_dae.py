"""Load DAE files with pycollada and dump per-node world-space triangle meshes to a pickle cache."""
import sys, pickle, time
import numpy as np
import collada


def walk(node, parent_m, out, top_name=None):
    m = parent_m @ getattr(node, 'matrix', np.eye(4))
    name = top_name
    if isinstance(node, collada.scene.Node):
        nm = (node.xmlnode.get('name') or node.id or '')
        name = nm
        for ch in node.children:
            if isinstance(ch, collada.scene.GeometryNode):
                g = ch.geometry
                matmap = {mn.symbol: mn.target for mn in ch.materials}
                for prim in g.primitives:
                    if not isinstance(prim, (collada.triangleset.TriangleSet, collada.polylist.Polylist, collada.polygons.Polygons)):
                        continue
                    tris = prim.triangleset() if not isinstance(prim, collada.triangleset.TriangleSet) else prim
                    if tris.vertex is None or len(tris.vertex_index) == 0:
                        continue
                    vi = tris.vertex_index.reshape(-1)
                    pos = tris.vertex[vi]
                    nrm = tris.normal[tris.normal_index.reshape(-1)] if tris.normal is not None else None
                    uv = uv1 = None
                    if tris.texcoordset and len(tris.texcoordset) > 0:
                        uv = tris.texcoordset[0][tris.texcoord_indexset[0].reshape(-1)]
                    if tris.texcoordset and len(tris.texcoordset) > 1:
                        uv1 = tris.texcoordset[1][tris.texcoord_indexset[1].reshape(-1)]
                    mat = matmap.get(tris.material)
                    matname = None
                    if mat is not None:
                        matname = mat.xmlnode.get('name') or mat.id
                    else:
                        matname = tris.material
                    # world transform
                    p = np.c_[pos, np.ones(len(pos))] @ m.T
                    p = p[:, :3]
                    if nrm is not None:
                        nm3 = np.linalg.inv(m[:3, :3]).T
                        nrm = nrm @ nm3.T
                        ln = np.linalg.norm(nrm, axis=1, keepdims=True); ln[ln == 0] = 1
                        nrm = nrm / ln
                    out.setdefault(name, []).append(dict(mat=matname, pos=p.astype(np.float32),
                        nrm=None if nrm is None else nrm.astype(np.float32),
                        uv=None if uv is None else uv.astype(np.float32), uv1=None if uv1 is None else uv1.astype(np.float32), flip=np.linalg.det(m[:3, :3]) < 0))
            elif isinstance(ch, collada.scene.Node):
                walk(ch, m, out, name)


def load(path):
    t = time.time()
    d = collada.Collada(path, ignore=[collada.common.DaeUnsupportedError, collada.common.DaeBrokenRefError])
    out = {}
    for n in d.scene.nodes:
        walk(n, np.eye(4), out)
    print(f'{path}: {len(out)} nodes in {time.time()-t:.1f}s', file=sys.stderr)
    return out


if __name__ == '__main__':
    res = {}
    for p in sys.argv[2:]:
        res[p] = load(p)
    pickle.dump(res, open(sys.argv[1], 'wb'))
