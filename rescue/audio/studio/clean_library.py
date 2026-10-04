#!/usr/bin/env python3
"""Remove rejected renders, fill only coverage gaps, then validate/publish local manifests."""
import argparse,collections,fcntl,json,shutil,time
from pathlib import Path
import studio as s
import quality as q
import audit_layer2 as layer2
import soundfile as sf
import numpy as np
from scipy.signal import resample_poly
from math import gcd
APP=s.ROOT/'rescue/app'
STATE=s.STATE/'cleanup-v1';STATE.mkdir(exist_ok=True)

def prepare(human_only=False, repetitions=False):
    report=json.loads((s.STATE/'quality-report.json').read_text());flagged=set() if human_only else {(r['id'],r['sha']) for r in report['clips'] if r['flags']}
    if repetitions:
        flagged.update((r['id'],r['sha']) for r in json.loads((s.STATE/'confirmed-repetitions.json').read_text()))
    reviews=q.database();latest={}
    for row in reviews.execute('SELECT * FROM decisions ORDER BY sequence'):latest[(row['clip_id'],row['sha'])]=row['decision']
    reviews.close();flagged.update(key for key,decision in latest.items() if decision=='reject')
    ledger=APP/'src/data/rejected-audio.json'
    previous=json.loads(ledger.read_text()) if ledger.exists() else []
    entries={(r['id'],r['sha256']) for r in previous}|flagged
    ledger.write_text(s.dumps([{'id':i,'sha256':h} for i,h in sorted(entries)]))
    db=s.connect();backup=STATE/'originals';backup.mkdir(exist_ok=True)
    removed=[]
    for r in db.execute('SELECT * FROM clips').fetchall():
        if (r['id'],r['sha']) not in flagged or r['status']=='rejected':continue
        p=Path(r['path'])
        if p.exists() and s.sha(p.read_bytes())!=r['sha']:raise ValueError('Changed clip; rerun scan: '+r['id'])
        if p.exists():shutil.move(p,backup/(r['id']+'-'+r['sha'][:12]+'.wav'))
        (backup/(r['id']+'.json')).write_text(s.dumps(dict(r)))
        db.execute("UPDATE clips SET status='rejected',review='rejected' WHERE id=?",(r['id'],));removed.append(r['id'])
    db.commit()
    manifests=[]
    for path in sorted((APP/'public/audio').glob('chatterbox-*/manifest.json')):
        original=STATE/(path.parent.name+'.json')
        if not original.exists():shutil.copy2(path,original)
        m=json.loads(original.read_text());manifests.append((path,m))
    available=collections.defaultdict(set);rows={r['id']:dict(r) for r in db.execute('SELECT * FROM clips')};candidates=collections.defaultdict(dict)
    for path,m in manifests:
        for clip in m['clips']:
            key=(clip['bankId'],clip['wordId']);voice=clip['voiceId'].split('-')[-1]
            candidates[key][voice]=clip['id']
            if rows[clip['id']]['status']=='complete':available[key].add(voice)
    needed=set()
    def require(key,voice):
        if voice in available[key]:return
        needed.add(candidates[key][voice]);available[key].add(voice)
    for key,voices in candidates.items():
        for v in sorted(voices):
            if len(available[key])>=2:break
            require(key,v)
    # AB should use one shared voice; X must use another. Fill reference-pair bridges.
    for path,m in manifests:
        code=path.parent.name.removeprefix('chatterbox-');cur=APP/f'src/data/{code}-chatterbox-curriculum.json'
        l=json.loads(cur.read_text());lookup={(c['text'],c['ipa']):(c['bankId'],c['wordId']) for c in m['clips']}
        for contrast in l['contrasts']:
            for pair in contrast['pairs']:
                a,b=[lookup[(w['text'],w['ipa'])] for w in pair['words']]
                if available[a]&available[b]:continue
                choices=set(candidates[a])&set(candidates[b]);v=min(choices,key=lambda v:((v not in available[a])+(v not in available[b]),v))
                require(a,v);require(b,v)
    plan=[rows[i] for i in sorted(needed,key=lambda i:(json.loads(rows[i]['details'])['bank'],i))]
    (STATE/'plan.json').write_text(s.dumps(plan));print(s.dumps({'removed':len(removed),'regenerationJobs':len(plan),'byBank':dict(collections.Counter(json.loads(r['details'])['bank'] for r in plan))}),flush=True);db.close();return plan

def regenerate():
    db=s.connect();plan=json.loads((STATE/'plan.json').read_text());model=None;bank=None;results=[];recognizer=None
    for row in plan:
        latest=db.execute('SELECT * FROM clips WHERE id=?',(row['id'],)).fetchone()
        if latest['status']=='complete':continue
        old=json.loads(row['details']);target=Path(row['path'])
        if bank!=old['bank']:
            if model:del model
            bank=old['bank'];model=s.Chatterbox(bank)
        outcome={'id':row['id'],'word':old['text'],'bank':bank,'accepted':False,'attempts':[]}
        for attempt in range(1,9):
            job=dict(old);job['seed']=(old['seed']+32452843*attempt)%2**32
            text=job.get('speechText',job['text'])
            job['speechText']=text if text.endswith(('.', '!', '?', '。')) else text+('。' if bank in ('ja','zh') else '.')
            render_key=s.identity([row['sha'],job['seed'],job['speechText'],job['settings']])[:12]
            path=STATE/(row['id']+'-'+render_key+f'-try-{attempt}.wav')
            if not path.exists():model.generate(job,path)
            metrics=q.measure(path);flags=q.absolute_flags(metrics)
            repeat=layer2.repeated_bursts(path)
            if repeat.get('possibleRepeatedBurst'):flags.append('possible_repeated_burst')
            peers=[]
            for peer in db.execute("SELECT path FROM clips WHERE word_id=? AND provider='chatterbox' AND status='complete'",(row['word_id'],)):
                peers.append(q.measure(peer['path'])['activeSpan'])
            if q.relative_outlier(metrics['activeSpan'],peers+[metrics['activeSpan']]):flags.append('same_word_duration_outlier')
            outcome['attempts'].append({'path':str(path),'flags':flags,'metrics':metrics})
            if flags:continue
            if recognizer is None:
                from faster_whisper import WhisperModel
                cache=Path.home()/'.cache/huggingface/hub/models--Systran--faster-whisper-medium'
                revision=(cache/'refs/main').read_text().strip()
                recognizer=WhisperModel(str(cache/'snapshots'/revision),device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True)
            wave,sr=sf.read(path,always_2d=True);divisor=gcd(sr,16000)
            wave=resample_poly(wave.mean(axis=1),16000//divisor,sr//divisor).astype(np.float32)
            segments,_=recognizer.transcribe(wave,language=layer2.LANG[bank],beam_size=3,temperature=0,condition_on_previous_text=False,vad_filter=False)
            transcript=' '.join(segment.text for segment in segments)
            outcome['attempts'][-1]['transcript']=transcript
            if 'asr_repeated_word' in layer2.transcript_flags(old['text'],transcript):
                flags.append('asr_repeated_word');continue
            target.parent.mkdir(exist_ok=True);shutil.copy2(path,target)
            job['technicalAudit']={**s.audit(target),'qualityMetrics':metrics};job['repair']={'reason':'flagged render removed; minimum voice coverage replacement','originalSha256':row['sha'],'pronunciationStatus':'unreviewed'}
            db.execute("UPDATE clips SET status='complete',review='unreviewed',sha=?,details=? WHERE id=?",(s.sha(target.read_bytes()),s.dumps(job),row['id']));db.commit();outcome['accepted']=True;break
        results.append(outcome);(STATE/'regeneration-results.json').write_text(s.dumps(results));print(s.dumps({'word':old['text'],'bank':bank,'accepted':outcome['accepted'],'attempts':len(outcome['attempts'])}),flush=True)
    db.close()

def export():
    db=s.connect();summary=[];failures=[];staged=[]
    for original in STATE.glob('chatterbox-*.json'):
        m=json.loads(original.read_text());clips=[];byword=collections.defaultdict(set)
        for clip in m['clips']:
            r=db.execute('SELECT * FROM clips WHERE id=?',(clip['id'],)).fetchone()
            if r['status']!='complete':continue
            path=Path(r['path']);sha=s.sha(path.read_bytes())
            if sha!=r['sha']:raise ValueError('Checksum mismatch')
            c=dict(clip);c.update(sha256=sha,url=f"/audio/{original.stem}/{clip['id']}-{sha[:12]}.wav",status='unreviewed');clips.append(c);byword[(c['text'],c['ipa'])].add(c['voiceId'])
        required={(c['text'],c['ipa']) for c in m['clips']}
        for w in required:
            if len(byword[w])<2:failures.append([original.stem,w,'below two voices'])
        code=original.stem.removeprefix('chatterbox-');curriculum=json.loads((APP/f'src/data/{code}-chatterbox-curriculum.json').read_text())
        for contrast in curriculum['contrasts']:
            for pair in contrast['pairs']:
                if not set.intersection(*(byword[(w['text'],w['ipa'])] for w in pair['words'])):failures.append([original.stem,contrast['id'],'no shared reference voice'])
        staged.append((original,m,clips));summary.append({'bank':code,'clips':len(clips),'words':len(required)})
    (STATE/'coverage.json').write_text(s.dumps({'summary':summary,'failures':failures}))
    if failures:raise ValueError(f'{len(failures)} coverage gaps remain; public manifests not updated.')
    for original,m,clips in staged:
        folder=APP/'public/audio'/original.stem;keep=set()
        for c in clips:
            source=Path(db.execute('SELECT path FROM clips WHERE id=?',(c['id'],)).fetchone()['path']);dest=APP/'public'/c['url'].lstrip('/');shutil.copy2(source,dest);keep.add(dest.name)
        m['clips']=clips;(folder/'manifest.json').write_text(s.dumps(m))
        for wav in folder.glob('*.wav'):
            if wav.name not in keep:wav.unlink()
    print(s.dumps({'coverage':'passed','banks':summary}),flush=True);db.close()
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['prepare','remove-human-rejects','remove-confirmed-repetitions','regenerate','export']);a=p.parse_args()
    with (s.STATE/'.run.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        {'prepare':prepare,'remove-human-rejects':lambda:prepare(True),'remove-confirmed-repetitions':lambda:prepare(True,True),'regenerate':regenerate,'export':export}[a.command]()
