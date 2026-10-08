#!/usr/bin/env python3
"""Stage approved Candidate F as US A v2. Offline/resumable; never edits live manifests or databases."""
import argparse, collections, fcntl, json, os, shutil, sqlite3, time
from pathlib import Path
import studio as s
import quality as q
import audit_layer2 as l2

VERSION='us-a-v2-candidate-f-4fdb19a2ec99'
REFERENCE_SHA='4fdb19a2ec999c5c874797c4c19ac69b7719cfb1241a3ff95015ca637fadcbd3'
RUN=s.STATE/'voice-replacements'/VERSION
PUBLIC=s.ROOT/'rescue/app/public/audio/chatterbox-us/manifest.json'

def save(path,data):
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');tmp.replace(path)

def prepare():
    RUN.mkdir(parents=True,exist_ok=True)
    if (RUN/'plan.json').exists():return json.loads((RUN/'plan.json').read_text())
    source=s.STATE/'realism-audition/replacement-candidates/candidate-F-reference.wav'
    assert s.sha(source.read_bytes())==REFERENCE_SHA,'Approved reference hash changed'
    shutil.copy2(source,RUN/'approved-reference.wav')
    shutil.copy2(PUBLIC,RUN/'original-public-manifest.json')
    for name in ('audio','quality'):
        with sqlite3.connect(f'file:{s.STATE/(name+".sqlite3")}?mode=ro',uri=True) as src, sqlite3.connect(RUN/(name+'-before.sqlite3')) as dst:src.backup(dst)
    db=sqlite3.connect(f'file:{s.STATE/"audio.sqlite3"}?mode=ro',uri=True);db.row_factory=sqlite3.Row
    words=[dict(r) for r in db.execute("SELECT * FROM words WHERE bank='en-US-ga' ORDER BY text,ipa")]
    prior=[dict(r) for r in db.execute("SELECT clips.* FROM clips JOIN words ON clips.word_id=words.id WHERE words.bank='en-US-ga' AND voice='A' AND provider='chatterbox'")];db.close()
    save(RUN/'original-a-records.json',prior)
    manifest=json.loads(PUBLIC.read_text());lookup={c['wordId']:c for c in manifest['clips']}
    assert set(lookup)=={w['id'] for w in words},'Required word inventory differs from live bank'
    jobs=[]
    for w in words:
        voice={'id':'A','name':'Voice A','locale':'en-US','referenceSha256':REFERENCE_SHA,'speakerVersion':VERSION,'ownerApprovedCandidate':'F'}
        job={'wordId':w['id'],'text':w['text'],'targetIPA':w['ipa'],'bank':'en-US-ga','locale':'en-US','provider':'chatterbox','voice':voice,'model':'mlx-community/chatterbox-multilingual-v3','modelRevision':s.MODEL_REV,'tokenizerRevision':s.TOKENIZER_REV,'settings':dict(s.SETTINGS),'seed':int(s.identity([VERSION,w['id']])[:8],16),'reviewStatus':'unreviewed','pronunciationVerified':False}
        job['id']=s.identity(job)
        job['publicTemplate']={k:v for k,v in lookup[w['id']].items() if k not in ('id','sha256','url','voiceId','status')}
        jobs.append(job)
    plan={'version':VERSION,'created':time.time(),'approvedReferenceSHA256':REFERENCE_SHA,'sourceManifestSHA256':s.sha(PUBLIC.read_bytes()),'expected':len(jobs),'jobs':jobs,'publication':'staging-only; explicit promotion after validation'}
    save(RUN/'plan.json',plan);return plan

def completed(job):
    p=RUN/'results'/(job['id']+'.json')
    if not p.exists():return None
    result=json.loads(p.read_text())
    if result['status']!='complete':return None
    clip=RUN/result['relativePath']
    assert clip.exists() and s.sha(clip.read_bytes())==result['sha256'],'Completed artifact changed: '+job['id']
    return result

def summary(plan,started):
    results=[completed(j) for j in plan['jobs']];good=[x for x in results if x]
    failed=[]
    for j in plan['jobs']:
        p=RUN/'results'/(j['id']+'.json')
        if p.exists() and json.loads(p.read_text())['status']!='complete':failed.append(j['id'])
    report={'version':VERSION,'expected':len(results),'completed':len(good),'needsReview':len(failed),'pending':len(results)-len(good)-len(failed),'verifiedAt':time.time(),'elapsedThisRunSeconds':round(time.monotonic()-started,2),'published':False,'pronunciationVerified':False,'status':'ready-for-integration-checks' if len(good)==len(results) else 'incomplete'}
    save(RUN/'summary.json',report)
    if len(good)==len(results):
        m=json.loads((RUN/'original-public-manifest.json').read_text());m['clips']=[c for c in m['clips'] if c['voiceId']!='chatterbox-us-A']
        for j,r in zip(plan['jobs'],results):
            filename=j['id']+'-'+r['sha256'][:12]+'.wav'
            m['clips'].append({**j['publicTemplate'],'id':j['id'],'voiceId':'chatterbox-us-A','speakerVersion':VERSION,'referenceSha256':REFERENCE_SHA,'sha256':r['sha256'],'url':'/audio/chatterbox-us/'+filename,'status':'unreviewed'})
        save(RUN/'staged-public-manifest.json',m)
        report['stagedClipCount']=len(m['clips']);save(RUN/'summary.json',report)
    return report

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--execute',action='store_true');ap.add_argument('--verify',action='store_true');ap.add_argument('--limit',type=int);ap.add_argument('--retry-flagged',action='store_true');args=ap.parse_args()
    plan=prepare();started=time.monotonic()
    if args.verify:print(json.dumps(summary(plan,started)));return
    print(json.dumps({'version':VERSION,'planned':plan['expected'],'runDirectory':str(RUN),'published':False}),flush=True)
    if not args.execute:return
    for sub in ('results','renders'): (RUN/sub).mkdir(exist_ok=True)
    with (s.STATE/'.run.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        save(RUN/'process.json',{'pid':os.getpid(),'started':time.time(),'command':'replace_us_voice_a.py --execute','status':'running'})
        import soundfile as sf
        model=s.Chatterbox();data,sr=sf.read(RUN/'approved-reference.wav',dtype='float32')
        assert s.sha((RUN/'approved-reference.wav').read_bytes())==REFERENCE_SHA
        model.conditions['A']=model.model.prepare_conditionals(model.mx.array(data),sr,s.SETTINGS['exaggeration'])
        n=0
        for i,job in enumerate(plan['jobs']):
            if completed(job):continue
            resultfile=RUN/'results'/(job['id']+'.json')
            if resultfile.exists() and not args.retry_flagged:continue
            attempts=json.loads(resultfile.read_text()).get('attempts',[]) if resultfile.exists() else []
            result={'id':job['id'],'word':job['text'],'wordId':job['wordId'],'status':'needs-review','attempts':attempts,'job':job}
            for a in range(len(attempts),len(attempts)+4):
                render={k:v for k,v in job.items() if k!='publicTemplate'};render['seed']=(job['seed']+104729*a)%2**32
                path=RUN/'renders'/(job['id']+f'-attempt-{a+1}.wav')
                if not path.exists():
                    temporary=path.with_suffix('.partial.wav');model.generate(render,temporary);temporary.replace(path)
                metrics=q.measure(path);flags=q.absolute_flags(metrics);repeat=l2.repeated_bursts(path)
                if repeat.get('possibleRepeatedBurst'):flags.append('possible_repeated_burst')
                if metrics['duration']>2.2:flags.append('isolated_word_longer_than_2_2_seconds')
                attempt={'relativePath':str(path.relative_to(RUN)),'sha256':s.sha(path.read_bytes()),'seed':render['seed'],'metrics':metrics,'repetitionCheck':repeat,'flags':flags}
                attempts.append(attempt)
                if not flags:result.update(status='complete',relativePath=attempt['relativePath'],sha256=attempt['sha256'],seed=attempt['seed'],technicalAudit=metrics,pronunciationVerified=False)
                save(resultfile,result)
                if result['status']=='complete':break
            n+=1;report=summary(plan,started)
            print(json.dumps({'index':i+1,'word':job['text'],'status':result['status'],'attempts':len(attempts),'completed':report['completed'],'expected':plan['expected'],'elapsedSeconds':report['elapsedThisRunSeconds']}),flush=True)
            if args.limit and n>=args.limit:break
        report=summary(plan,started);save(RUN/'process.json',{'pid':os.getpid(),'finished':time.time(),'status':report['status']});print(json.dumps(report),flush=True)
if __name__=='__main__':main()
