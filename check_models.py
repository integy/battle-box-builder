import sys, trimesh, numpy as np

for path in sys.argv[1:]:
    m = trimesh.load(path)
    print(f"== {path.split('/')[-1]}: {len(m.faces)} tris | watertight {m.is_watertight} "
          f"| winding {m.is_winding_consistent} | vol {abs(m.volume)/1000:.1f} cm3 "
          f"| bounds {np.round(m.bounds,2).tolist()} | bodies {len(m.split(only_watertight=False))}")