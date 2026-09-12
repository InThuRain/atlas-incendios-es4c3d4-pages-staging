#!/usr/bin/env python3
"""Gate reproducible del TAR nacional exacto antes de un deploy Pages.

No construye datos ni decide qué artifact usar. Las dos identidades de esta
release están fijadas aquí para que un operador no pueda sustituirlas mediante
inputs de ``workflow_dispatch``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_national_product_artifact as site_checker  # noqa: E402


GOLDEN_ARCHIVE = {
    "bytes": 812902400,
    "sha256": "4bcc80fefbd9209f3808ae60011b9d59b4075dd0b27053d60167ce1af781edb7",
}
GOLDEN_SITE = {
    "site_file_count": 497,
    "site_total_bytes": 812510441,
    "payload_file_count": 495,
    "payload_total_bytes": 812291384,
    "payload_fingerprint": "10582ec0dc896654006c2162ea66e2fd7710790c477bb072bfb2473c51b18df3",
    "asset_manifest_sha256": "377b565548b6ff1376acde99e0cae458eb2b72d704c39587990126a0e69cf96e",
    "site_identity_sha256": "f5e80a728f45057692f36ba41f76900c9d00b9c962cedc4eb591e29e813da04e",
}
STAGING_MARKER = b"atlas-incendios-es4c3d4-pages-staging"


def contract_from_file(path: Path | None) -> dict:
    """Return the immutable default or an explicitly versioned local contract.

    The default remains the artifact currently in production.  A future patch
    is selected only by a reviewed JSON file, never by workflow input values.
    """
    if path is None:
        return {"archive": GOLDEN_ARCHIVE, "site": GOLDEN_SITE}
    payload = json.loads(path.read_text(encoding="utf-8"))
    archive, site = payload.get("archive"), payload.get("site")
    if not isinstance(archive, dict) or not isinstance(site, dict):
        raise ValueError("invalid release identity contract")
    required_archive = set(GOLDEN_ARCHIVE)
    required_site = set(GOLDEN_SITE)
    if set(archive) != required_archive or set(site) != required_site:
        raise ValueError("incomplete release identity contract")
    return {"archive": archive, "site": site}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def mismatches(expected: dict, actual: dict) -> list[str]:
    return [field for field, value in expected.items() if actual.get(field) != value]


def archive_gate(path: Path, expected: dict) -> dict:
    actual = {"bytes": path.stat().st_size if path.is_file() else None, "sha256": None}
    if path.is_file() and actual["bytes"] == expected["bytes"]:
        actual["sha256"] = sha256(path)
    failures = [f"archive:{field}" for field in mismatches(expected, actual)]
    return {"valid": not failures, "path": str(path), "actual": actual, "failures": failures}


def safe_members(archive: Path) -> list[tarfile.TarInfo]:
    # Los artifacts de Pages se empaquetan con gzip determinista. ``r:*``
    # detecta el contenedor, pero no relaja ninguna validación de miembros.
    with tarfile.open(archive, "r:*") as source:
        members = source.getmembers()
    failures: list[str] = []
    names: set[str] = set()
    for member in members:
        name = PurePosixPath(member.name)
        if name.is_absolute() or not member.name or ".." in name.parts or member.issym() or member.islnk():
            failures.append(member.name)
        if not (member.isfile() or member.isdir()):
            failures.append(member.name)
        if member.isfile():
            names.add(member.name)
    required = {"asset-manifest.json", "site-identity.json", "index.html"}
    if not required.issubset(names):
        failures.append("required-root-files")
    if failures:
        raise ValueError("unsafe or unexpected TAR members: " + ", ".join(sorted(set(failures))[:10]))
    return members


def extract_safely(archive: Path, destination: Path) -> None:
    if destination.exists() and any(destination.iterdir()):
        raise ValueError(f"destination is not empty: {destination}")
    destination.mkdir(parents=True, exist_ok=True)
    members = safe_members(archive)
    with tarfile.open(archive, "r:*") as source:
        for member in members:
            source.extract(member, destination)


def count_staging_references(site: Path) -> int:
    count = 0
    for path in site.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        with path.open("rb") as handle:
            previous = b""
            while True:
                block = handle.read(1024 * 1024)
                if not block:
                    break
                count += (previous + block).count(STAGING_MARKER)
                previous = (previous + block)[-len(STAGING_MARKER) + 1 :]
    return count


def site_gate(site: Path, expected: dict) -> dict:
    actual = site_checker.check(site)
    failures = list(actual.get("failures", []))
    for field in mismatches(expected, actual):
        failures.append(f"site:{field}")
    staging_references = count_staging_references(site) if actual.get("valid") else None
    if staging_references:
        failures.append("site:staging-reference")
    return {
        "valid": not failures,
        "actual": {field: actual.get(field) for field in expected},
        "checker_failures": actual.get("failures", []),
        "staging_references": staging_references,
        "failures": sorted(set(failures)),
    }


def gate(archive: Path, site: Path | None = None, extract_to: Path | None = None, contract: dict | None = None) -> dict:
    contract = contract or contract_from_file(None)
    archive_result = archive_gate(archive, contract["archive"])
    if not archive_result["valid"]:
        return {"valid": False, "archive": archive_result, "site": None}
    if site is not None:
        site_result = site_gate(site, contract["site"])
        return {"valid": site_result["valid"], "archive": archive_result, "site": site_result}
    if extract_to is not None:
        extract_safely(archive, extract_to)
        site_result = site_gate(extract_to, contract["site"])
        return {"valid": site_result["valid"], "archive": archive_result, "site": site_result}
    with tempfile.TemporaryDirectory(prefix="atlas-national-gate-") as directory:
        temporary_site = Path(directory) / "site"
        extract_safely(archive, temporary_site)
        site_result = site_gate(temporary_site, contract["site"])
    return {"valid": site_result["valid"], "archive": archive_result, "site": site_result}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--site", type=Path)
    parser.add_argument("--extract-to", type=Path)
    parser.add_argument("--contract", type=Path, help="Contrato JSON inmutable para un candidato ya identificado.")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.site and args.extract_to:
        parser.error("--site and --extract-to are mutually exclusive")
    try:
        result = gate(args.archive, args.site, args.extract_to, contract_from_file(args.contract))
    except (OSError, ValueError, tarfile.TarError) as error:
        result = {"valid": False, "failure": str(error)}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result.get("valid") else 1


if __name__ == "__main__":
    raise SystemExit(main())

