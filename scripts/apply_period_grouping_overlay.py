"""Exact accepted two-file period grouping overlay; no product builds."""
import argparse
import json
import shutil
from pathlib import Path
import check_national_product_artifact as C

BASE='69970d0ec310293527872f51297deb0d0215b79461e541dfc499ce8d85927174'
FINAL='3439fe609a7cbf50a0cf65c064eef112d73e920432630781c2e4a54c2b3747b0'
IDENTITY='78e228105c72e4fde4d27f25a85f6f40903a43ce2e8d76ec981ebb05e28a20b8'
CHANGED={'index.html','styles.css'}
PATHS=CHANGED|{'asset-manifest.json','site-identity.json'}
HOST='https://atlas-incendios-pmtiles.danisaezbuedo.workers.dev'
EXPECTED=dict(site_file_count=541,site_total_bytes=817618828,payload_file_count=539,
 payload_total_bytes=817380380,payload_fingerprint='342cb577b36b7a7b6758d73e1eaa5e71cbeb4bf78c36406b8995452a527dcb8b',
 asset_manifest_sha256=FINAL,site_identity_sha256=IDENTITY)

def physical(site,final=False):
    r=C.check(site)
    assert r['failures']==['external runtime dependencies'],r
    if final:assert all(r[k]==v for k,v in EXPECTED.items()),r
    m=json.loads((site/'asset-manifest.json').read_text())
    assert m['external_runtime_dependencies']==[HOST+'/esfire30.pmtiles',HOST+'/basemap.pmtiles']
    assert m['runtime_external_data_domains']==[HOST.split('//')[1]]
    return r

def contract(base,overlay):
    assert C.sha256(base/'asset-manifest.json')==BASE
    assert C.sha256(overlay/'asset-manifest.json')==FINAL
    assert C.sha256(overlay/'site-identity.json')==IDENTITY
    a={x['path']:x['sha256'] for x in json.loads((base/'asset-manifest.json').read_text())['files']}
    b={x['path']:x['sha256'] for x in json.loads((overlay/'asset-manifest.json').read_text())['files']}
    assert a.keys()==b.keys() and {p for p in a if a[p]!=b[p]}==CHANGED
    for name in CHANGED:assert C.sha256(overlay/name)==b[name]
    return {'changed':sorted(CHANGED),'unchanged':537}

def apply(site,overlay):
    before=physical(site);delta=contract(site,overlay)
    assert {p.relative_to(overlay).as_posix() for p in overlay.rglob('*') if p.is_file()}==PATHS
    for name in PATHS:shutil.copyfile(overlay/name,site/name)
    return {'passed':True,'before':before,'delta':delta,'physical_identity':physical(site,True)}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--site',type=Path,required=True);p.add_argument('--overlay',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();r=apply(a.site,a.overlay);a.output.write_text(json.dumps(r,indent=2)+'\n');print('PASS')
