import sys, trimesh, numpy as np

new = trimesh.load(sys.argv[1])
orig = trimesh.load('/Users/eric/.hermes/workspace/battle-box-web/models/tray.stl')
# band sits 4.05 mm tall at the top of each part; compare in band-local coordinates
def sec_area(mesh, z):
    s = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if s is None:
        return 0.0
    p, _ = s.to_planar()
    return p.area / 100

h_new = new.bounds[1][2]
print("new height", round(h_new, 2), "orig 37.5")
for off in (0.6, 1.5, 2.5, 3.5):
    a = sec_area(new, h_new - off)
    b = sec_area(orig, 37.5 - off)
    flag = "OK" if abs(a - b) < 0.25 else "DIFF"
    print(f"  band offset -{off:4.1f} mm: new {a:7.3f}  orig {b:7.3f}  {flag}")