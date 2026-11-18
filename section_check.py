import sys, trimesh, numpy as np

for path in sys.argv[1:]:
    m = trimesh.load(path)
    s = m.section(plane_origin=[0, 0, 20], plane_normal=[0, 0, 1])
    p, _ = s.to_planar() if s else (None, None)
    area = p.area / 100 if p else 0
    rings = len(p.polygons_full) if p else 0
    print(f"{path.split('/')[-1]:24s} z=20 material {area:7.2f} cm2  outlines {rings}  vol {abs(m.volume)/1000:6.1f}")