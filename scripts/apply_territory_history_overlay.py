"""Copy the accepted territory history artifact bytes, without running builders."""
import argparse
import json
import shutil
from pathlib import Path
import check_national_product_artifact as C
import apply_permalink_compact_overlay as P

FINAL = '3f980f175a6628fea16e581d87ce54bec45ad0d04087c0e6159b261c08ff120b'
IDENTITY = 'ae8416d53a8442c47de88fd7b6dc25d9c7fc9a33fc73a3fa0a5456c130c8c7d8'
CHANGED = {'index.html', 'styles.css', 'metrics-histogram.mjs', 'highlights.mjs'}
ADDED = {'territory-history.mjs'}
PATHS = CHANGED | ADDED | {'asset-manifest.json', 'site-identity.json'}

def physical(site):
    result = C.check(site)
    assert result['failures'] == ['external runtime dependencies'], result
    assert result['site_identity_sha256'] == IDENTITY
    assert result['asset_manifest_sha256'] == FINAL
    assert result['site_file_count'] == 542 and result['site_total_bytes'] == 817633894
    assert result['payload_fingerprint'] == 'c693135c6ce1ce190f5d1b590d0333267a3af580a8616bb8e46c27fe94e5b7d7'
    return result

def contract(site, overlay):
    assert C.sha256(site/'asset-manifest.json') == P.FINAL
    assert C.sha256(overlay/'asset-manifest.json') == FINAL
    assert C.sha256(overlay/'site-identity.json') == IDENTITY
    assert not any(p.is_symlink() for p in overlay.rglob('*'))
    assert {p.relative_to(overlay).as_posix() for p in overlay.rglob('*') if p.is_file()} == PATHS
    a = C.read_json(site/'asset-manifest.json')
    b = C.read_json(overlay/'asset-manifest.json')
    for key in ['external_runtime_dependencies', 'runtime_external_data_domains']:
        assert a[key] == b[key]
    old = {r['path']:r for r in a['files']}
    new = {r['path']:r for r in b['files']}
    assert set(new)-set(old) == ADDED and not set(old)-set(new)
    assert {p for p in old if old[p]['sha256'] != new[p]['sha256']} == CHANGED
    for name in CHANGED | ADDED:
        assert C.sha256(overlay/name) == new[name]['sha256']
        assert (overlay/name).stat().st_size == new[name]['bytes']
        assert not (site/name).is_symlink()
    return dict(changed=sorted(CHANGED), added=sorted(ADDED), unchanged_payload_files=535)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--site', type=Path, required=True)
    parser.add_argument('--overlay', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify-candidate', type=Path)
    args = parser.parse_args()
    before = P.physical(args.site, True)
    delta = contract(args.site, args.overlay)
    if args.verify_candidate:
        final = physical(args.verify_candidate)
        for name in PATHS:
            assert (args.overlay/name).read_bytes() == (args.verify_candidate/name).read_bytes()
    else:
        for name in PATHS:
            assert not (args.site/name).is_symlink()
            shutil.copyfile(args.overlay/name, args.site/name)
        final = physical(args.site)
    args.output.write_text(json.dumps(dict(passed=True, before=before, delta=delta, physical_identity=final), indent=2)+'\n')
    print('PASS_EXACT_ARTIFACT')
