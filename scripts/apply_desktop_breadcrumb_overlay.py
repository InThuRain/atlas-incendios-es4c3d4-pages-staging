"""Exact accepted three-file desktop breadcrumb overlay; no product builds."""
import argparse
import json
import shutil
from pathlib import Path
import check_national_product_artifact as C

BASE='e7b28f71454e6434afe5fe4e3a304b91881521ac29110f5b196f2c3cd9f0c47b'
FINAL='69970d0ec310293527872f51297deb0d0215b79461e541dfc499ce8d85927174'
IDENTITY='4e5ffdb2ebbd6f15c36ef115d8439a2908335cdefcce2381533f27f046ea3dfb'
CHANGED={'index.html','styles.css','product-shell.mjs'}
PATHS=CHANGED|{'asset-manifest.json','site-identity.json'}
HOST='https://atlas-incendios-pmtiles.danisaezbuedo.workers.dev'
EXPECTED=dict(site_file_count=541,site_total_bytes=817618674,payload_file_count=539,
 payload_total_bytes=817380206,payload_fingerprint='9815c3b98fd27002a6aa9e25b8503e4ca995ba52d1743d45f75695c17fa78466',
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
    return {'changed':sorted(CHANGED),'unchanged':536}

def apply(site,overlay):
    before=physical(site);delta=contract(site,overlay)
    assert {p.relative_to(overlay).as_posix() for p in overlay.rglob('*') if p.is_file()}==PATHS
    for name in PATHS:shutil.copyfile(overlay/name,site/name)
    return {'passed':True,'before':before,'delta':delta,'physical_identity':physical(site,True)}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--site',type=Path,required=True);p.add_argument('--overlay',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();r=apply(a.site,a.overlay);a.output.write_text(json.dumps(r,indent=2)+'\n');print('PASS')
