"""Post-hoc development ablation on saved results, not new validation audio."""
import hashlib
import json
from pathlib import Path

from run_tracker_comparison import metrics, write_json
from tracker_compare import ROOT

SOURCE=ROOT/'experiments/2026-10-07-tracker-comparison'
OUT=ROOT/'experiments/2026-10-07-agreement-veto'


def extend(rows):
    for r in rows:
        # Match the averaging candidate's coverage EXACTLY. Change only which
        # coordinates are returned, making this a controlled fusion ablation.
        r['methods']['cross_method_veto']=dict(r['methods']['burg5500'])
        r['methods']['cross_method_veto']['accepted']=r['methods']['cross_method_fixed']['accepted']
    return rows


def summary(rows):
    return {m:metrics(rows,m) for m in ('burg_two_ceiling','cross_method_fixed','cross_method_veto')}


def main():
    assert json.loads((SOURCE/'run.json').read_text())['status']=='complete'
    clean=extend([json.loads(l) for l in (SOURCE/'clean-rows.jsonl').read_text().splitlines()])
    stress=extend(json.loads((SOURCE/'stress-rows.json').read_text()))
    groups={'all':clean,'adults':[r for r in clean if r['group'] in 'mw'],
            'adult_ih_iy':[r for r in clean if r['group'] in 'mw' and r['vowel'] in ('ih','iy')],
            'g':[r for r in clean if r['group']=='g'],
            'f0_above_250':[r for r in clean if r['ref_f0']>=250]}
    ids={r['id'] for r in stress}
    groups['matched_clean_stress_subset']=[r for r in clean if r['id'] in ids]
    groups.update({c:[r for r in stress if r['condition']==c] for c in sorted({r['condition'] for r in stress})})
    write_json(OUT/'summary.json',{g:summary(rows) for g,rows in groups.items()})
    write_json(OUT/'run.json',{'status':'complete','paid_spend_usd':0,
        'source_hashes':{name:hashlib.sha256((SOURCE/name).read_bytes()).hexdigest()
                         for name in ('clean-rows.jsonl','stress-rows.json','run.json')},
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'protocol_sha256':hashlib.sha256((OUT/'protocol.json').read_bytes()).hexdigest(),
        'scope':'post-hoc ablation; same previously evaluated audio; no additional independent evidence'})
    for group in ('all','adults','adult_ih_iy'):
        print(group,json.dumps(summary(groups[group])))


if __name__=='__main__':main()
