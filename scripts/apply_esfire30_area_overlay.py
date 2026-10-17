"""Promote only the pinned, accepted per-geometry ESFire30 area bytes."""
import argparse
import json
import shutil
from pathlib import Path
import check_national_product_artifact as checker

BASE='bdb4ca55c5482b14ff123b781af3e228099ee245d10c02e5b37538954358ab90'
FINAL='e7b28f71454e6434afe5fe4e3a304b91881521ac29110f5b196f2c3cd9f0c47b'
IDENTITY='5063664284a31a4fa731e48bdce36771ce1f4bdbe1c262a2fa8b7f3e1cd700b9'
PAYLOAD='eae6fb6d298d953ec7e999dc37ad741842a8788e8fa5e835b2514c1766a7f086'
HOST='https://atlas-incendios-pmtiles.danisaezbuedo.workers.dev'
CHANGED={'index.html','runtime/app.js','runtime/direct_popup.mjs'}
ADDED={'runtime/esfire30_mapped_area.mjs','data/esfire30-mapped-area/provenance.json'}|{
    f'data/esfire30-mapped-area/{year}.json' for year in range(1985,2022)}
PATHS=CHANGED|ADDED|{'asset-manifest.json','site-identity.json'}
EXPECTED=dict(site_file_count=541,site_total_bytes=817618350,payload_file_count=539,
    payload_total_bytes=817379885,payload_fingerprint=PAYLOAD,asset_manifest_sha256=FINAL,
    site_identity_sha256=IDENTITY)

def physical(site,final=False):
    result=checker.check(site)
    assert result['failures']==['external runtime dependencies'],result
    if final:assert all(result[k]==v for k,v in EXPECTED.items()),result
    manifest=json.loads((site/'asset-manifest.json').read_text())
    assert manifest['external_runtime_dependencies']==[HOST+'/esfire30.pmtiles',HOST+'/basemap.pmtiles']
    assert manifest['runtime_external_data_domains']==[HOST.split('//')[1]]
    return result

def contract(base,final):
    assert checker.sha256(base/'asset-manifest.json')==BASE
    assert checker.sha256(final/'asset-manifest.json')==FINAL
    assert checker.sha256(final/'site-identity.json')==IDENTITY
    a={r['path']:r['sha256'] for r in json.loads((base/'asset-manifest.json').read_text())['files']}
    b={r['path']:r['sha256'] for r in json.loads((final/'asset-manifest.json').read_text())['files']}
    assert set(a)<=set(b) and set(b)-set(a)==ADDED
    assert {p for p in a if a[p]!=b[p]}==CHANGED
    for name in CHANGED|ADDED:assert checker.sha256(final/name)==b[name],name
    provenance=json.loads((final/'data/esfire30-mapped-area/provenance.json').read_text())
    assert provenance['source_crs']=='EPSG:23030' and provenance['units']=='ha'
    assert provenance['method']=='WGS84_GEODESIC_ED50_41_IGN_GRID'
    assert provenance['provenance']=='DERIVED_FROM_GEOMETRY'
    count=0
    for year in range(1985,2022):
        data=json.loads((final/f'data/esfire30-mapped-area/{year}.json').read_text())
        assert data['schema']=='esfire30-mapped-area-v1' and data['year']==year
        assert all(data[k]==provenance[k] for k in ('method','provenance','units'))
        assert set(data['areas'])=={f'esfire30:v1:{year}:{i}' for i in range(len(data['areas']))}
        assert all(type(v) in (int,float) and v>=0 for v in data['areas'].values())
        count+=len(data['areas'])
    assert count==119498
    return dict(changed=sorted(CHANGED),added=sorted(ADDED),unchanged=497,area_count=count)

def apply(site,overlay):
    before=physical(site)
    assert {p.relative_to(overlay).as_posix() for p in overlay.rglob('*') if p.is_file()}==PATHS
    delta=contract(site,overlay)
    for name in sorted(PATHS):
        target=site/name;target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(overlay/name,target)
    return dict(passed=True,delta=delta,before=before,physical_identity=physical(site,True))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--site',type=Path,required=True)
    p.add_argument('--overlay',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();result=apply(a.site,a.overlay)
    a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
