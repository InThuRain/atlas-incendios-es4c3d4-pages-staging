"""Promote accepted COMPACT_V1 bytes; no builders or metadata generation."""
import argparse
import json
import shutil
from pathlib import Path
import check_national_product_artifact as C
import apply_basemap_selector_overlay as B

FINAL = "70174efc7603b19f0b0ed977ea41d8fb68ed28ba93aa4186b7a749774f6d52ad"
IDENTITY = "fd857aa59bed7f39d88582f3ccde47bd8578ea327bf74cfaf867974f02a96c05"
CHANGED = {"basemap-selector.mjs", "product-shell.mjs", "runtime/app.js",
           "runtime/runtime_state.mjs", "runtime/state_serialization.mjs"}
REMOVED = {"runtime/compat_gva_v1.mjs"}
PATHS = CHANGED | {"asset-manifest.json", "site-identity.json"}
EXPECTED = dict(site_file_count=541, site_total_bytes=817614639,
                payload_file_count=539, payload_total_bytes=817375280,
                payload_fingerprint="c88df35e8bd8537231f78a53cfae5d3c3e8af260bfdef4b1f5362f26012caf46",
                asset_manifest_sha256=FINAL, site_identity_sha256=IDENTITY)


def physical(site, final=False):
    result = C.check(site)
    assert result["failures"] == ["external runtime dependencies"], result
    manifest = C.read_json(site / "asset-manifest.json")
    assert manifest["external_runtime_dependencies"] == B.ENDPOINTS
    assert manifest["runtime_external_data_domains"] == B.DOMAINS
    expected = EXPECTED if final else B.EXPECTED
    assert all(result[k] == v for k, v in expected.items()), result
    return result


def contract(base, overlay):
    assert C.sha256(base / "asset-manifest.json") == B.FINAL
    assert C.sha256(overlay / "asset-manifest.json") == FINAL
    assert C.sha256(overlay / "site-identity.json") == IDENTITY
    a = {r["path"]: r["sha256"] for r in C.read_json(base / "asset-manifest.json")["files"]}
    b = {r["path"]: r["sha256"] for r in C.read_json(overlay / "asset-manifest.json")["files"]}
    assert not set(b) - set(a) and set(a) - set(b) == REMOVED
    assert {p for p in set(a) & set(b) if a[p] != b[p]} == CHANGED
    assert not any(p.is_symlink() for p in overlay.rglob("*"))
    assert {p.relative_to(overlay).as_posix() for p in overlay.rglob("*") if p.is_file()} == PATHS
    for name in CHANGED:
        assert C.sha256(overlay / name) == b[name]
    for name in REMOVED:
        assert not (base / name).is_symlink()
        assert C.sha256(base / name) == a[name]
    return {"changed": sorted(CHANGED), "removed": sorted(REMOVED), "unchanged": 534}


def apply(site, overlay):
    before = physical(site)
    delta = contract(site, overlay)
    for name in PATHS:
        assert not (site / name).is_symlink()
        shutil.copyfile(overlay / name, site / name)
    for name in REMOVED:
        (site / name).unlink()
    return {"passed": True, "before": before, "delta": delta,
            "physical_identity": physical(site, True)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--overlay", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = apply(args.site, args.overlay)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print("PASS")
