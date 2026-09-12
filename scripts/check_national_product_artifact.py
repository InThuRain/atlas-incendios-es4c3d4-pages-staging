#!/usr/bin/env python3
"""Verificador físico independiente del artifact nacional de producto E3D1."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT = ROOT / "build/national-product-staging"
SITE_METADATA = {"asset-manifest.json", "site-identity.json"}
EXPECTED = {
    "esfire30_fire_pmtiles": (63052056, "3c6eb10ba146008cdabf36646d48a4c7a92c1c1357ad90679f6b5dce42013cfe"),
    "protomaps_basemap_pmtiles": (293324998, "72bb270ff6fc18ccba3042834f9a9eb72901c243e7dec88b3ebb63eaafaeb729"),
}
SUMMARY_FINGERPRINT = "2546247b68ef8e27fed3334cf5fb4a027056f094e36420213080c431bfb850e4"
SUMMARY_MANIFEST_SHA256 = "b09e69648b6b2dee03265f12a00624de72d4006301b04d796889c1bf151a8e7b"
HIGHLIGHTS_MANIFEST_SHA256 = "578cddd7a3d341d0fd7aa72382b7159c603724155798309fc338a515fdc2762a"
BASEMAP_CONTRACT = json.loads((ROOT / "config/national-basemap-protomaps-20260902-z12.json").read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def check(artifact: Path) -> dict:
    failures: list[str] = []
    manifest_path = artifact / "asset-manifest.json"
    identity_path = artifact / "site-identity.json"
    if not manifest_path.is_file() or not identity_path.is_file():
        return {"valid": False, "failures": ["missing identity metadata"], "artifact": str(artifact)}
    manifest = read_json(manifest_path)
    identity = read_json(identity_path)
    records = manifest.get("files", [])
    declared_paths = [row.get("path") for row in records]
    if len(declared_paths) != len(set(declared_paths)):
        failures.append("duplicate manifest path")
    expected_paths = set(declared_paths) | SITE_METADATA
    actual_paths = {
        path.relative_to(artifact).as_posix()
        for path in artifact.rglob("*")
        if path.is_file() and not path.is_symlink()
    }
    if actual_paths - expected_paths:
        failures.append("extra asset")
    if expected_paths - actual_paths:
        failures.append("missing asset")
    for row in records:
        path = artifact / str(row.get("path", ""))
        if not path.is_file():
            continue
        if path.stat().st_size != row.get("bytes"):
            failures.append(f"size mismatch:{row.get('path')}")
        elif sha256(path) != row.get("sha256"):
            failures.append(f"SHA mismatch:{row.get('path')}")
        for field in ("logical_id", "family", "source_version", "required"):
            if field not in row:
                failures.append(f"manifest field:{field}:{row.get('path')}")
    ordered = sorted(records, key=lambda row: row["path"])
    fingerprint_bytes = "".join(
        f"{row['path']}\t{row['bytes']}\t{row['sha256']}\n" for row in ordered
    ).encode("utf-8")
    fingerprint = hashlib.sha256(fingerprint_bytes).hexdigest()
    payload_bytes = sum(row.get("bytes", 0) for row in records)
    physical_bytes = sum((artifact / path).stat().st_size for path in actual_paths)
    if manifest.get("payload_file_count") != len(records) or manifest.get("payload_total_bytes") != payload_bytes:
        failures.append("manifest mismatch")
    if manifest.get("payload_fingerprint", {}).get("sha256") != fingerprint:
        failures.append("payload fingerprint mismatch")
    if identity.get("site_file_count") != len(actual_paths) or identity.get("site_total_bytes") != f"{physical_bytes:020d}":
        failures.append("site identity mismatch")
    manifest_sha = sha256(manifest_path)
    if identity.get("asset_manifest", {}).get("sha256") != manifest_sha:
        failures.append("asset-manifest SHA mismatch")
    if any(identity.get(key) != manifest.get(key) for key in ("payload_file_count", "payload_total_bytes", "payload_fingerprint", "pmtiles_assets")):
        failures.append("site/payload identity mismatch")
    pmtiles = manifest.get("pmtiles_assets", {})
    if set(pmtiles) != set(EXPECTED):
        failures.append("PMTiles logical identities")
    for logical_id, (size, digest) in EXPECTED.items():
        row = pmtiles.get(logical_id, {})
        path = artifact / row.get("runtime_path", "")
        if row.get("logical_id") != logical_id or not path.is_file() or path.stat().st_size != size or sha256(path) != digest:
            failures.append(f"PMTiles identity:{logical_id}")
    summary = artifact / "data/summary/national-ux-summary-v1/manifest.json"
    highlights = artifact / "data/highlights/national-highlights-v1/manifest.json"
    if not summary.is_file() or sha256(summary) != SUMMARY_MANIFEST_SHA256 or read_json(summary).get("fingerprint") != SUMMARY_FINGERPRINT:
        failures.append("summary identity")
    if not highlights.is_file() or sha256(highlights) != HIGHLIGHTS_MANIFEST_SHA256:
        failures.append("highlights identity")
    glyph_contract = BASEMAP_CONTRACT["glyphs"]
    expected_glyphs = []
    for descriptor in glyph_contract["files"]:
        relative = glyph_contract["runtime_template"].replace("{fontstack}", glyph_contract["fontstack"]).replace("{range}", descriptor["range"])
        glyph = artifact / relative
        expected_glyphs.append({"range": descriptor["range"], "runtime_path": relative, "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]})
        if not glyph.is_file():
            failures.append(f'glyph missing:{descriptor["range"]}')
        elif glyph.stat().st_size != descriptor["bytes"]:
            failures.append(f'glyph bytes:{descriptor["range"]}')
        elif sha256(glyph) != descriptor["sha256"]:
            failures.append(f'glyph SHA:{descriptor["range"]}')
    declared_glyphs = manifest.get("inputs", {}).get("basemap", {}).get("glyphs", {})
    if declared_glyphs.get("files") != expected_glyphs or declared_glyphs.get("file_count") != len(expected_glyphs):
        failures.append("glyph manifest mismatch")
    if manifest.get("external_runtime_dependencies") != [] or manifest.get("runtime_external_data_domains") != []:
        failures.append("external runtime dependencies")
    return {
        "valid": not failures,
        "failures": sorted(set(failures)),
        "artifact": str(artifact),
        "site_file_count": len(actual_paths),
        "site_total_bytes": physical_bytes,
        "payload_file_count": len(records),
        "payload_total_bytes": payload_bytes,
        "payload_fingerprint": fingerprint,
        "asset_manifest_sha256": manifest_sha,
        "site_identity_sha256": sha256(identity_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--repro-artifact", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    primary = check(args.artifact)
    result = {"phase": "ES-4E3D1", "primary": primary, "reproducibility": None}
    if args.repro_artifact:
        secondary = check(args.repro_artifact)
        fields = ("site_file_count", "site_total_bytes", "payload_file_count", "payload_total_bytes", "payload_fingerprint", "asset_manifest_sha256", "site_identity_sha256")
        matches = {field: primary.get(field) == secondary.get(field) for field in fields}
        result["reproducibility"] = {
            "secondary": secondary,
            "matches": matches,
            "status": "PASS" if secondary["valid"] and all(matches.values()) else "FAIL",
        }
    result["valid"] = primary["valid"] and (result["reproducibility"] is None or result["reproducibility"]["status"] == "PASS")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

