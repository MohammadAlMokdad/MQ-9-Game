"""Download Poly Haven model packages (glTF + bin + textures) preserving relative paths.

Usage (plain Python 3, no Blender needed):
    python -I scripts/blender/fetch_polyhaven.py --out <download_dir> [--res 1k] <asset_id> [<asset_id> ...]

Each asset lands in <download_dir>/<asset_id>/ as <asset_id>_<res>.gltf plus the files from the API's
"include" map (bin + textures). --maps NAME:FMT[,NAME:FMT] also fetches extra texture maps that the glTF
package lacks into <asset_id>/textures/ (e.g. --maps Alpha:png for foliage whose glTF lost its alpha). Uses https://api.polyhaven.com/files/<asset_id>. Existing files with the
expected size are skipped, so reruns are cheap. Relative paths from the API are sanitised (no absolute
paths, no '..').
"""
import argparse
import json
import os
import sys
import urllib.request

API = "https://api.polyhaven.com/files/"
UA = {"User-Agent": "gunship-asset-prep/1.0"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def safe_join(root, rel):
    rel = rel.replace("\\", "/")
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." or ":" in p for p in parts):
        raise ValueError("unsafe relative path in API response: %r" % rel)
    path = os.path.join(root, *parts)
    if not os.path.abspath(path).startswith(os.path.abspath(root) + os.sep):
        raise ValueError("path escapes asset dir: %r" % rel)
    return path


def download(url, path, size=None):
    if os.path.isfile(path) and (size is None or os.path.getsize(path) == size):
        return "skip"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = fetch(url)
    if size is not None and len(data) != size:
        print("  warning: size mismatch for %s (%d != %d)" % (url, len(data), size))
    with open(path, "wb") as f:
        f.write(data)
    return "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--res", default="1k")
    ap.add_argument("--fmt", default="gltf")
    ap.add_argument("--maps", default="", help="extra maps, e.g. Alpha:png,02_diff:jpg")
    ap.add_argument("assets", nargs="+")
    a = ap.parse_args()
    failed = []
    for asset in a.assets:
        try:
            info = json.loads(fetch(API + asset))
            pkg = info[a.fmt][a.res][a.fmt]
            root = os.path.join(a.out, asset)
            main_path = os.path.join(root, "%s_%s.%s" % (asset, a.res, a.fmt))
            print(asset, download(pkg["url"], main_path, pkg.get("size")), main_path)
            for rel, f in sorted(pkg.get("include", {}).items()):
                print("  ", download(f["url"], safe_join(root, rel), f.get("size")), rel)
            for spec in [m for m in a.maps.split(",") if m]:
                name, _, ext = spec.partition(":")
                if name not in info:
                    print("   no map %r for %s" % (name, asset))
                    continue
                f = info[name][a.res][ext or "png"]
                rel = "textures/" + f["url"].rsplit("/", 1)[-1]
                print("  ", download(f["url"], safe_join(root, rel), f.get("size")), rel)
        except Exception as e:  # keep going with the other assets
            print("FAILED", asset, e)
            failed.append(asset)
    if failed:
        sys.exit("failed: " + " ".join(failed))


if __name__ == "__main__":
    main()
