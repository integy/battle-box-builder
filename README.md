# Battle Box Builder

Live: https://integy.github.io/battle-box-builder/

Parametric web app for the 234 × 150 mm **Battle Box** tray + lid.

The two original parts (`Battle-Box-Tray-High.stl`, `Battle-Box-Lid-Blank.stl`) are used as
templates: the interlock band at the top of the tray is copied **verbatim** from the source mesh,
so every generated tray still mates with the original lid. Only the middle is parametric.

## Controls

- **Height** — 20 … 120 mm (original 37.5). The wall stretches, the interlock band rides up with it.
- **Columns / Rows** — 1 … 8 → compartment grid (divides the 218 × 142 mm cavity).
- **Divider thickness** — 1.2 … 8 mm between compartments.
- **Wall clearance** — inset of the compartment grid from the cavity wall (0 … 8 mm).
- **Download tray STL** / **Download lid STL** — binary STL, print-ready orientation
  (tray base down at Z = 0, lid already top-down).

Stats in the panel: outer size, plastic volume + PLA weight, pocket size, triangle count.

## How it is built

Measured from the source meshes:

| z (mm) | feature |
|---|---|
| 0 – 2.40 | solid base plate |
| 2.40 – 5.50 | base flare / chamfer ring |
| 5.50 – 33.45 | constant 8 mm perimeter wall — **this is what stretches** |
| 33.45 – 37.50 | interlock band + rails — **copied 1:1 from the STL** |

Pipeline (browser, no build step, no server logic):

1. `models/base.stl` — the original tray below z = 5.5
2. `models/wall.json` — the exact wall cross-section extracted at z = 20 (105 + 81 points, rounded corners kept)
3. `models/band.stl` — the original interlock band above z = 33.45
4. wall prism = that cross-section extruded to `height − 5.5`, then translated up by the height delta
5. dividers = boxes fused into floor and walls
6. everything unioned with **manifold-3d** (WASM) → watertight single-body solid, exported as binary STL

Verified on the exported files: watertight, winding-consistent, single body; band cross-sections at
every height identical to the original (7.304 / 10.893 / 12.160 / 10.728 cm² at −0.6/−1.5/−2.5/−3.5 mm
below the top).

## Run

```bash
cd battle-box-web
python3 -m http.server 8770        # then open http://127.0.0.1:8770/
```

Needs network for three.js + manifold-3d from jsDelivr. Must be served over http:// (the STL/JSON
loads are `fetch`es; `file://` is blocked by CORS).

## Layout

```
index.html        UI + import map
app.js            geometry pipeline, viewer, STL export
style.css
models/base.stl   original tray below the wall
models/band.stl   original interlock band
models/lid.stl    original lid
models/wall.json  wall cross-section at z=20
```

Numbers come from `check_models.py` / `section_check.py` / `band_check.py` (trimesh, python3.9 venv at
`~/.hermes/tools/stl-venv`).