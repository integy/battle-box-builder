import sys, trimesh, numpy as np

new = sys.argv[1]
orig = sys.argv[2]
a = trimesh.load(new)
o = trimesh.load(orig)
print("new:", len(a.faces), "tris | watertight", a.is_watertight, "| winding", a.is_winding_consistent,
      "| vol", round(abs(a.volume) / 1000, 1), "| bounds", np.round(a.bounds, 2).tolist())
print("orig:", len(o.faces), "tris | vol", round(abs(o.volume) / 1000, 1))
print("new bodies:", len(a.split(only_watertight=False)))
for z in (10, 20, 32, 34.5, 36):
    sa = a.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    so = o.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    pa, _ = sa.to_planar()
    po, _ = so.to_planar()
    print(f"  z={z:5.1f} new={pa.area / 100:7.2f} cm2   orig={po.area / 100:7.2f} cm2")