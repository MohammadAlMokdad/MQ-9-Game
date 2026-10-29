# Prop sources

All props in this folder are reduced versions of [Poly Haven](https://polyhaven.com) models, licensed
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, no attribution required).
Authors are listed as a courtesy.

| File | Poly Haven asset | Authors | Licence |
|---|---|---|---|
| `boulder_a.glb` | [Namaqualand Boulder 03](https://polyhaven.com/a/namaqualand_boulder_03) | Jenelle van Heerden, Dario Barresi | CC0 |
| `boulder_b.glb` | [Namaqualand Boulder 04](https://polyhaven.com/a/namaqualand_boulder_04) | Jenelle van Heerden | CC0 |
| `boulder_c.glb` | [Namaqualand Boulder 05](https://polyhaven.com/a/namaqualand_boulder_05) | Jenelle van Heerden, Dario Barresi | CC0 |
| `boulder_d.glb` | [Namaqualand Boulder 06](https://polyhaven.com/a/namaqualand_boulder_06) | Greg Zaal, Jenelle van Heerden | CC0 |
| `bush_dry_a.glb` … `bush_dry_e.glb` | [Wild Rooibos Bush](https://polyhaven.com/a/wild_rooibos_bush) (bushes a–e) | James Ray Cock, Jenelle van Heerden | CC0 |
| `bush_green_a.glb` … `bush_green_g.glb` | [Searsia Lucida](https://polyhaven.com/a/searsia_lucida) (bushes a–g, LOD0) | James Ray Cock, Jenelle van Heerden | CC0 |
| `barrel_red.glb` | [Barrel 01](https://polyhaven.com/a/Barrel_01) | Jorge Camacho | CC0 |
| `barrel_blue.glb` | [Barrel 03](https://polyhaven.com/a/barrel_03) | Serhii Khromov | CC0 |
| `aircon.glb` | [Exterior Aircon Unit](https://polyhaven.com/a/exterior_aircon_unit) (plain unit) | Monsta3D | CC0 |
| `covered_car.glb` | [Covered Car](https://polyhaven.com/a/covered_car) | MP | CC0 |
| `road_barrier.glb` | [Concrete Road Barrier](https://polyhaven.com/a/concrete_road_barrier) | Amal Kumar | CC0 |
| `crate.glb` | [Wooden Crate 01](https://polyhaven.com/a/wooden_crate_01) | James Ray Cock | CC0 |

## Changes from the originals

Made from the 1k glTF downloads with `scripts/blender/build_assets.py` (which runs
`scripts/blender/convert_prop.py`):

- Units are metres at real-world size, Y is up, the origin is at the bottom centre, and the long axis runs along +Z (the car faces +Z). Each file has one mesh with transforms applied.
- Triangle counts are reduced. Boulders, barrels, the barrier and the car are collapse-decimated, then re-unwrapped, and their base colour is baked from the original. The boulders also get a baked normal map. The crate and the aircon unit are convex-hull boxes with the detail baked in.
  - The aircon keeps only the plain (not rusted) unit. Its wall brackets, bolts, drain hose and the pipes behind it are removed.
  - On the bushes, branches are decimated and only the main ones are kept. The alpha-cutout leaf cards are thinned by removing whole cards, and the cards that remain are enlarged so the crown keeps its outline. Most remaining cards are rebuilt as two-triangle quads.
- Textures are a 512×512 base colour, JPEG except on the bushes. The bushes use one WebP with alpha (`EXT_texture_webp`), and their leaves use alphaMode `MASK`. The bush alpha comes from Poly Haven's separate Alpha map, because the glTF package references a JPEG with no alpha. Roughness, metalness and AO maps are replaced by constant values.
