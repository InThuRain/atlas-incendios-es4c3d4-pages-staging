"""Pinned accepted basemap overlay on the existing Period staging artifact."""
import argparse
import json
import shutil
from pathlib import Path
import check_national_product_artifact as C

BASE = "3439fe609a7cbf50a0cf65c064eef112d73e920432630781c2e4a54c2b3747b0"
V107 = "5b898fb34e4216229ce1818de77e5b5068a3a6bb22c7c8192bde204466472905"
FINAL = "2850e337ded491a1f140dc57fbeaf701cf0c11a3b4f59e1a3d83e3cc62bad860"
IDENTITY = "cd3016d89cb079d0d7c6a99291f88e00cc2b255a524d84c487efb2648aedec48"
CHANGED = {"index.html", "styles.css", "product-shell.mjs"}
ADDED = {"basemap-selector.mjs"}
PATHS = CHANGED | ADDED | {"asset-manifest.json", "site-identity.json"}
HOST = "https://atlas-incendios-pmtiles.danisaezbuedo.workers.dev"
ENDPOINTS = [HOST + "/esfire30.pmtiles", HOST + "/basemap.pmtiles",
             "https://servicios.idee.es/wmts/mdt", "https://www.ign.es/wmts/pnoa-ma"]
DOMAINS = [HOST.split("//")[1], "servicios.idee.es", "www.ign.es"]
EXPECTED = dict(site_file_count=542, site_total_bytes=817626028,
                payload_file_count=540, payload_total_bytes=817386841,
                payload_fingerprint="d66d7fcff87ec07bcaee55024076aaca9f4f869996409f609418f0db88454fb1",
                asset_manifest_sha256=FINAL, site_identity_sha256=IDENTITY)


def physical(site, final=False):
    result = C.check(site)
    assert result["failures"] == ["external runtime dependencies"], result
    manifest = C.read_json(site / "asset-manifest.json")
    assert manifest["external_runtime_dependencies"] == (ENDPOINTS if final else ENDPOINTS[:2])
    assert manifest["runtime_external_data_domains"] == (DOMAINS if final else DOMAINS[:1])
    if final:
        assert all(result[k] == v for k, v in EXPECTED.items()), result
    return result


def contract(base, overlay, base_hash=BASE):
    assert C.sha256(base / "asset-manifest.json") == base_hash
    assert C.sha256(overlay / "asset-manifest.json") == FINAL
    assert C.sha256(overlay / "site-identity.json") == IDENTITY
    a = {r["path"]: r["sha256"] for r in C.read_json(base / "asset-manifest.json")["files"]}
    b = {r["path"]: r["sha256"] for r in C.read_json(overlay / "asset-manifest.json")["files"]}
    assert set(b) - set(a) == ADDED and not set(a) - set(b)
    assert {p for p in a if a[p] != b[p]} == CHANGED
    for name in CHANGED | ADDED:
        assert C.sha256(overlay / name) == b[name]
    return {"changed": sorted(CHANGED), "added": sorted(ADDED), "unchanged": 536}


def apply(site, overlay):
    before = physical(site)
    delta = contract(site, overlay)
    assert {p.relative_to(overlay).as_posix() for p in overlay.rglob("*") if p.is_file()} == PATHS
    for name in PATHS:
        shutil.copyfile(overlay / name, site / name)
    return {"passed": True, "before": before, "delta": delta, "physical_identity": physical(site, True)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--overlay", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = apply(args.site, args.overlay)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print("PASS")
