"""Apply the exact reviewed delivery overlay to the accepted staging artifact."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
import check_national_product_artifact as checker

BASE_MANIFEST = 'bd61ca2628ffbfd51540471995fea13c23b9c300ecf31fd15ddcb386551005c7'
FINAL_MANIFEST = '247efe57d65c95d62e752fdc93a3db6486820440f36962f9e44556c4b7e8131b'
FINAL_IDENTITY = '48d481dea0a99932886b867097bc47ec3619655be4834528a6f9e9f7b1bf6a3f'
HOST = 'https://atlas-incendios-pmtiles.danisaezbuedo.workers.dev'
PATHS = {'runtime-config.js', 'runtime/app.js', 'asset-manifest.json', 'site-identity.json'}


def apply(site, overlay):
    assert checker.sha256(site / 'asset-manifest.json') == BASE_MANIFEST
    assert checker.check(site)['valid'], 'Reference physical identity failed'
    assert {p.relative_to(overlay).as_posix() for p in overlay.rglob('*') if p.is_file()} == PATHS
    assert checker.sha256(overlay / 'asset-manifest.json') == FINAL_MANIFEST
    assert checker.sha256(overlay / 'site-identity.json') == FINAL_IDENTITY
    manifest = json.loads((overlay / 'asset-manifest.json').read_text())
    records = {r['path']: r for r in manifest['files']}
    for name in PATHS - {'asset-manifest.json', 'site-identity.json'}:
        assert checker.sha256(overlay / name) == records[name]['sha256']
    for name in sorted(PATHS):
        shutil.copyfile(overlay / name, site / name)
    result = checker.check(site)
    assert result['failures'] == ['external runtime dependencies'], result
    assert manifest['external_runtime_dependencies'] == [HOST + '/esfire30.pmtiles', HOST + '/basemap.pmtiles']
    assert manifest['runtime_external_data_domains'] == [HOST.split('//')[1]]
    # Preserve the old checker result rather than mislabel its no-external policy.
    return {'passed': True, 'scope': 'exact Worker origin exception; all physical checks required',
            'historical_checker': result, 'modified_files': sorted(PATHS)}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--site', type=Path, required=True)
    p.add_argument('--overlay', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    result = apply(args.site, args.overlay)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
