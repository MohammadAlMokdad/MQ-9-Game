"""Rebuild the game's prop, round and round-icon assets from their sources (runs Blender headless).

Usage (plain Python 3, from the project root):
  python -I scripts/blender/build_assets.py --blender "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --downloads <download dir> [--only props,rounds,icons] [--assets boulder_a,crate,...] [--jobs 3] \
      [--previews <dir>] [--no-fetch]

props   Poly Haven models (CC0, 1k glTF packages, fetched into --downloads with fetch_polyhaven.py)
        -> public/assets/props/*.glb via convert_prop.py
rounds  missles/25-40-105mm/<cal>/scene.gltf -> public/assets/models/rounds/r25|r40|r105.glb
icons   the same rounds -> public/assets/ui/round_25|40|105.png via render_icon.py
Every conversion prints its RESULT line (triangles, materials, size, bbox); full logs go to
<previews or downloads>/logs/. A final inspect_models.py pass reloads every output and prints its
stats (and renders preview sheets into --previews when given).
"""
import argparse
import concurrent.futures as cf
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PROPS_OUT = os.path.join(ROOT, "public", "assets", "props")
ROUNDS_OUT = os.path.join(ROOT, "public", "assets", "models", "rounds")
UI_OUT = os.path.join(ROOT, "public", "assets", "ui")
ROUNDS_SRC = os.path.join(ROOT, "missles", "25-40-105mm")

BOULDER = ["--tris", "600", "--bake", "--normal", "--sharp-angle", "180", "--min-part-size", "0.05"]
BUSH = ["--tris", "900", "--cards", "leaves|twigs", "--min-part-size", "0.03", "--fill-holes",
        "--min-tris-per-part", "14", "--protect-seams", "no", "--card-share", "0.65",
        "--card-material-share", "twigs=0.1", "--sharp-angle", "70"]

# output name -> (Poly Haven id, extra maps to fetch, convert_prop.py arguments; {dl} = download dir)
PROPS = {
    "boulder_a": ("namaqualand_boulder_03", "", BOULDER),
    "boulder_b": ("namaqualand_boulder_04", "", BOULDER),
    "boulder_c": ("namaqualand_boulder_05", "", BOULDER),
    "boulder_d": ("namaqualand_boulder_06", "", BOULDER),
    "barrel_red": ("Barrel_01", "", ["--tris", "250", "--bake", "--sharp-angle", "45"]),
    "barrel_blue": ("barrel_03", "", ["--tris", "250", "--bake", "--sharp-angle", "45"]),
    # the plain (not rusted) unit; parts below the box (wall brackets, bolts, drain hose) and the
    # pipes behind it are dropped; the box hull is baked from the rest. Poly Haven's glTF points
    # material 02's base colour at the opacity map, so the real 02 diffuse is fetched and used.
    "aircon": ("exterior_aircon_unit", "02_diff:jpg",
               ["--objects", "^exterior_aircon_unit$", "--keep-parts-in=-2,0.11,-0.11,2,2,2",
                "--proxy", "hull", "--proxy-min-part-size", "0.5", "--tris", "300",
                "--base-map", "unit_02$={dl}/exterior_aircon_unit/textures/exterior_aircon_unit_02_diff_1k.jpg",
                "--bake-extrusion", "0.04", "--bake-ray", "0.14", "--sharp-angle", "30"]),
    "covered_car": ("covered_car", "", ["--tris", "1500", "--bake", "--double-sided", "--sharp-angle", "50"]),
    "road_barrier": ("concrete_road_barrier", "", ["--tris", "200", "--bake", "--sharp-angle", "40",
                                                   "--min-part-size", "0.05"]),
    # crate body + lid as a hull (rope handles, latch and hinge are baked onto it, not modelled)
    "crate": ("wooden_crate_01", "", ["--tris", "120", "--proxy", "hull", "--proxy-parts-in=-0.36,-1,-1,0.36,1,1",
                                      "--proxy-min-part-size", "0.2", "--bake-extrusion", "0.07",
                                      "--bake-ray", "0.16", "--sharp-angle", "30"]),
}
for _l in "abcde":
    PROPS["bush_dry_" + _l] = ("wild_rooibos_bush", "Alpha:png", BUSH + [
        "--objects", "^wild_rooibos_bush_%s$" % _l,
        "--alpha-map", "leaves|twigs={dl}/wild_rooibos_bush/textures/wild_rooibos_bush_alpha_1k.png"])
for _l in "abcdefg":
    PROPS["bush_green_" + _l] = ("searsia_lucida", "Alpha:png", BUSH + [
        "--objects", "^searsia_lucida_%s_LOD0$" % _l,
        "--alpha-map", "leaves|twigs={dl}/searsia_lucida/textures/searsia_lucida_alpha_1k.png"])

ROUNDS = {"r25": "25mm", "r40": "40mm", "r105": "105mm"}
ROUND_ARGS = ["--keep-objects", "--max-tris-per-mesh", "3000", "--normal", "--tangents", "no",
              "--jpeg-quality", "90", "--normal-quality", "92", "--sharp-angle", "35",
              "--mat-props", "Capsula:metal=1,rough=0.35;Projetil:metal=0,rough=0.5"]


def blender(args, exe, script, extra, log_path):
    cmd = [exe, "-b", "--factory-startup", "--python", os.path.join(HERE, script), "--"] + extra
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, errors="replace")
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(" ".join('"%s"' % c if " " in c else c for c in cmd) + "\n\n" + r.stdout + r.stderr)
    keep = [ln for ln in (r.stdout + r.stderr).splitlines()
            if ln.startswith(("RESULT", "ICON", "WARNING over", "WARNING origin", "Traceback", "Error"))
            or "Error:" in ln]
    status = "ok" if r.returncode == 0 and not any(k.startswith(("Traceback", "Error")) for k in keep) else "FAILED"
    return status, keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blender", required=True)
    ap.add_argument("--downloads", required=True)
    ap.add_argument("--only", default="props,rounds,icons")
    ap.add_argument("--assets", default="", help="comma list of output names to build (default all)")
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--previews", default=None)
    ap.add_argument("--no-fetch", action="store_true")
    a = ap.parse_args()
    only = set(a.only.split(","))
    want = set(x for x in a.assets.split(",") if x)
    dl = os.path.abspath(a.downloads)
    logs = os.path.join(os.path.abspath(a.previews or dl), "logs")
    jobs = []  # (name, script, args)

    if "props" in only:
        props = {k: v for k, v in PROPS.items() if not want or k in want}
        if props and not a.no_fetch:
            by_maps = {}
            for asset, maps, _ in props.values():
                by_maps.setdefault(maps, set()).add(asset)
            for maps, assets in by_maps.items():
                cmd = [sys.executable, "-I", os.path.join(HERE, "fetch_polyhaven.py"), "--out", dl]
                if maps:
                    cmd += ["--maps", maps]
                subprocess.run(cmd + sorted(assets), check=True)
        for name, (asset, _maps, args) in props.items():
            extra = ["--in", os.path.join(dl, asset, asset + "_1k.gltf"),
                     "--out", os.path.join(PROPS_OUT, name + ".glb")] + [x.replace("{dl}", dl) for x in args]
            jobs.append((name, "convert_prop.py", extra))
    if "rounds" in only:
        for name, cal in ROUNDS.items():
            if not want or name in want:
                jobs.append((name, "convert_prop.py", ["--in", os.path.join(ROUNDS_SRC, cal, "scene.gltf"),
                                                       "--out", os.path.join(ROUNDS_OUT, name + ".glb")] + ROUND_ARGS))
    if "icons" in only:
        for name, cal in ROUNDS.items():
            icon = "round_" + cal[:-2]
            if not want or icon in want:
                # rendered from the full-resolution source so the markings stay crisp
                jobs.append((icon, "render_icon.py", ["--in", os.path.join(ROUNDS_SRC, cal, "scene.gltf"),
                                                      "--out", os.path.join(UI_OUT, icon + ".png"),
                                                      "--size", "512x128", "--fill", "0.9", "--nose", "+y"]))

    failed = []
    with cf.ThreadPoolExecutor(max_workers=max(1, a.jobs)) as ex:
        futs = {ex.submit(blender, a, a.blender, script, extra, os.path.join(logs, name + ".log")): name
                for name, script, extra in jobs}
        for fut in cf.as_completed(futs):
            name = futs[fut]
            status, lines = fut.result()
            print("[%s] %s" % (status, name))
            for ln in lines:
                print("    " + ln)
            if status != "ok":
                failed.append(name)

    outputs = []
    for name, script, extra in jobs:
        if script == "convert_prop.py":
            outputs.append(extra[extra.index("--out") + 1])
    if outputs:
        extra = (["--preview-dir", os.path.abspath(a.previews)] if a.previews else []) + outputs
        status, _ = blender(a, a.blender, "inspect_models.py", extra, os.path.join(logs, "inspect.log"))
        with open(os.path.join(logs, "inspect.log"), encoding="utf-8") as f:
            for ln in f:
                if "KB  tris=" in ln or ln.startswith("  bbox") or ln.startswith("  center"):
                    print(ln.rstrip())
    if failed:
        sys.exit("failed: " + ", ".join(failed))


if __name__ == "__main__":
    main()
