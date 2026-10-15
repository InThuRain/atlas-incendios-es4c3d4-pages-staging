"""CSS-only promotion of the physically accepted popup candidate."""
import argparse
import json
import shutil
from pathlib import Path
import check_national_product_artifact as checker
from apply_worker_product_overlay import HOST

BASE = 'a90500c0fccf2d96e46774f778691d949218e1b9d1a01cc351f12d1049a9be72'
FINAL = '9c52c92a122dfa7cbe0ca83a20cf2c8cc5e1810364eb84ee3974ef4bb19585be'
IDENTITY = 'ec5b21d05a6e16541b9b3301e95c6c1e1ba49601bd78bc63d3b68d4ee0aa5b56'
PAYLOAD = 'dcdfbb83389a2c34dff5264e45b164ef6b6d0e4a23d77f7817c3b63785e99eb8'
PATHS = {'styles.css', 'asset-manifest.json', 'site-identity.json'}

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
    assert {p for p in a if a[p] != b[p]} == {'styles.css'}
    assert new['external_runtime_dependencies'] == [HOST + '/esfire30.pmtiles', HOST + '/basemap.pmtiles']
    assert new['runtime_external_data_domains'] == [HOST.split('//')[1]]
    assert checker.sha256(overlay / 'styles.css') == b['styles.css']
    for name in sorted(PATHS):
        shutil.copyfile(overlay / name, site / name)
    result = checker.check(site)
    assert result['failures'] == ['external runtime dependencies'], result
    assert result['payload_fingerprint'] == PAYLOAD
    assert result['asset_manifest_sha256'] == FINAL
    assert result['site_identity_sha256'] == IDENTITY
    assert result['site_file_count'] == 502 and result['site_total_bytes'] == 812570572
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
