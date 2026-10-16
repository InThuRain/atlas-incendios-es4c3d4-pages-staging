"""Exact two-file promotion of the physically accepted histogram brush."""
import argparse
import json
import shutil
from pathlib import Path
import check_national_product_artifact as checker
from apply_worker_product_overlay import HOST

BASE = '9c52c92a122dfa7cbe0ca83a20cf2c8cc5e1810364eb84ee3974ef4bb19585be'
FINAL = 'bdb4ca55c5482b14ff123b781af3e228099ee245d10c02e5b37538954358ab90'
IDENTITY = 'd5465e24c167d3fffd504e336faef3744459f58633991bf62636b36af72757b2'
PAYLOAD = '8f6a620497d630d747aef432fd0070f5b322e4c3fbbe42c263c6d4aebd7d7bca'
PATHS = {'metrics-histogram.mjs', 'styles.css', 'asset-manifest.json', 'site-identity.json'}

def apply(site, overlay):
    assert checker.sha256(site / 'asset-manifest.json') == BASE
    assert checker.check(site)['failures'] == ['external runtime dependencies']
    assert {p.relative_to(overlay).as_posix() for p in overlay.rglob('*') if p.is_file()} == PATHS
    assert checker.sha256(overlay / 'asset-manifest.json') == FINAL
    assert checker.sha256(overlay / 'site-identity.json') == IDENTITY
    old = json.loads((site / 'asset-manifest.json').read_text())
    new = json.loads((overlay / 'asset-manifest.json').read_text())
    a = {r['path']: r['sha256'] for r in old['files']}
    b = {r['path']: r['sha256'] for r in new['files']}
    assert a.keys() == b.keys()
    assert {p for p in a if a[p] != b[p]} == {'styles.css', 'metrics-histogram.mjs'}
    assert new['external_runtime_dependencies'] == [HOST + '/esfire30.pmtiles', HOST + '/basemap.pmtiles']
    assert new['runtime_external_data_domains'] == [HOST.split('//')[1]]
    for name in ('styles.css', 'metrics-histogram.mjs'):
        assert checker.sha256(overlay / name) == b[name]
    for name in sorted(PATHS):
        shutil.copyfile(overlay / name, site / name)
    result = checker.check(site)
    assert result['failures'] == ['external runtime dependencies'], result
    assert result['payload_fingerprint'] == PAYLOAD
    assert result['asset_manifest_sha256'] == FINAL
    assert result['site_identity_sha256'] == IDENTITY
    assert result['site_file_count'] == 502 and result['site_total_bytes'] == 812575454
    assert result['payload_file_count'] == 500 and result['payload_total_bytes'] == 812353482
    return {'passed': True, 'modified_files': sorted(PATHS), 'physical_identity': result}

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--site', type=Path, required=True)
    p.add_argument('--overlay', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    result = apply(args.site, args.overlay)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
