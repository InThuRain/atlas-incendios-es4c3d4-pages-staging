"""Promote only the accepted local presentation, retaining the Worker guard."""
import argparse
import json
import shutil
from pathlib import Path
import check_national_product_artifact as checker
from apply_worker_product_overlay import HOST

BASE = '247efe57d65c95d62e752fdc93a3db6486820440f36962f9e44556c4b7e8131b'
FINAL = 'a90500c0fccf2d96e46774f778691d949218e1b9d1a01cc351f12d1049a9be72'
IDENTITY = '37b9611772e484e8f11060198d92eb89bc3fb193ccd9e23d34ed722592282c01'
PAYLOAD = '164d67a0ec13a9f75a6b69fc72e205621ee7299ab56d6c9a581aa9e753750250'
CHANGES = {'index.html', 'styles.css', 'product-shell.mjs', 'metrics-histogram.mjs',
           'highlights.mjs', 'runtime/direct_popup.mjs'}
PATHS = CHANGES | {'asset-manifest.json', 'site-identity.json'}

def apply(site, overlay):
    assert checker.sha256(site / 'asset-manifest.json') == BASE
    before = checker.check(site)
    assert before['failures'] == ['external runtime dependencies'], before
    assert {p.relative_to(overlay).as_posix() for p in overlay.rglob('*') if p.is_file()} == PATHS
    assert checker.sha256(overlay / 'asset-manifest.json') == FINAL
    assert checker.sha256(overlay / 'site-identity.json') == IDENTITY
    old = json.loads((site / 'asset-manifest.json').read_text())
    new = json.loads((overlay / 'asset-manifest.json').read_text())
    a = {r['path']: r['sha256'] for r in old['files']}
    b = {r['path']: r['sha256'] for r in new['files']}
    assert a.keys() == b.keys()
    assert {p for p in a if a[p] != b[p]} == CHANGES
    assert new['external_runtime_dependencies'] == [HOST + '/esfire30.pmtiles', HOST + '/basemap.pmtiles']
    assert new['runtime_external_data_domains'] == [HOST.split('//')[1]]
    for name in CHANGES:
        assert checker.sha256(overlay / name) == b[name]
    for name in sorted(PATHS):
        shutil.copyfile(overlay / name, site / name)
    result = checker.check(site)
    assert result['failures'] == ['external runtime dependencies'], result
    assert result['payload_fingerprint'] == PAYLOAD
    assert result['asset_manifest_sha256'] == FINAL
    assert result['site_identity_sha256'] == IDENTITY
    assert result['site_file_count'] == 502 and result['site_total_bytes'] == 812570288
    return {'passed': True, 'modified_files': sorted(PATHS), 'physical_identity': result,
            'scope': 'Only the two accepted Worker origins exempted from historical zero-external policy'}

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--site', type=Path, required=True)
    p.add_argument('--overlay', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    result = apply(args.site, args.overlay)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
