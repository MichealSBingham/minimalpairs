"""Choose 80 test utterances by speaker/ID hashes before inspecting model outputs."""
from pathlib import Path
import hashlib,json
from acquire import ROOT,fetch

def table(name):
    return dict(line.split(maxsplit=1) for line in (ROOT/'data/test'/name).read_text().splitlines())

def main():
    provenance=json.loads((ROOT/'artifacts/provenance.json').read_text())
    base=f'https://raw.githubusercontent.com/jimbozhang/speechocean762/{provenance["dataset_revision"]}/'
    ages=table('spk2age'); genders=table('spk2gender'); speakers=table('utt2spk'); paths=table('wav.scp')
    scores=json.loads((ROOT/'data/resource/scores.json').read_text())
    key=lambda s:hashlib.sha256(('minimalpairs-pilot-v1:'+s).encode()).hexdigest()
    selected=[]
    for child in [False,True]:
        eligible=[s for s in set(speakers.values()) if (float(ages[s])<18)==child]
        for speaker in sorted(eligible,key=key)[:20]:
            utterances=sorted([u for u,s in speakers.items() if s==speaker],key=key)[:2]
            for uid in utterances:
                path=ROOT/'data'/paths[uid]
                data=fetch(base+paths[uid],path)
                selected.append({'id':uid,'speaker':speaker,'age':float(ages[speaker]),
                    'gender':genders[speaker], 'path':str(path.relative_to(ROOT)),
                    'sha256':hashlib.sha256(data).hexdigest(), 'score':scores[uid]})
        print('Downloaded',len(selected),'utterances',flush=True)
    (ROOT/'artifacts/benchmark-manifest.json').write_text(json.dumps(selected,indent=2))
    print('Selected',len(selected),'utterances from',len(set(x['speaker'] for x in selected)),'speakers')

if __name__=='__main__': main()
