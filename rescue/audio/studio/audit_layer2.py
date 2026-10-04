#!/usr/bin/env python3
"""Resumable local transcription and repeated-burst triage. Never edits/rejects audio."""
import argparse, collections, fcntl, hashlib, json, os, sqlite3, time, unicodedata
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import stft, resample, resample_poly
from math import gcd
import quality as q
VERSION='layer2-v1'
LANG={'en-US-ga':'en','en-GB-ssbe':'en',**{x:x for x in ['fr','de','es','it','zh','pt','ru','ja']}}

def normalize(text):
    return ''.join(c for c in unicodedata.normalize('NFKC',text).casefold() if unicodedata.category(c)[0] in 'LN')

def transcript_flags(expected,heard):
    a,b=normalize(expected),normalize(heard)
    if not b:return ['asr_empty']
    if a==b:return []
    if a and b==a*(len(b)//len(a)) and len(b)>len(a):return ['asr_repeated_word']
    return ['asr_text_mismatch']

def repeated_bursts(path):
    x,sr=sf.read(path,always_2d=True);x=x.mean(axis=1)
    hop=max(1,int(sr*.01));energy=np.array([np.sqrt(np.mean(x[i:i+hop]**2)) for i in range(0,len(x),hop)])
    if not len(energy) or energy.max()<.003:return {'repeatScore':0,'bursts':0}
    active=energy>max(.003,energy.max()*.08)
    # Fill gaps shorter than 60 ms, avoiding splits at normal closure noise.
    for i in range(1,len(active)-1):
        if active[i-1] and not active[i]:
            ends=np.flatnonzero(active[i:])
            if len(ends) and ends[0]<6:active[i:i+ends[0]]=True
    edges=np.diff(np.r_[False,active,False].astype(int));spans=list(zip(np.flatnonzero(edges==1),np.flatnonzero(edges==-1)))
    spans=[(a*hop,min(b*hop,len(x))) for a,b in spans if (b-a)*hop/sr>=.16]
    def feature(a,b):
        _,_,z=stft(x[a:b],sr,nperseg=min(512,b-a),noverlap=min(384,(b-a)//2))
        z=np.log1p(np.abs(z[:100])*100);z=resample(z,40,axis=1);z-=z.mean()
        return z.ravel()/max(np.linalg.norm(z),1e-12)
    best=0
    for i,(a,b) in enumerate(spans):
        for c,d in spans[i+1:]:
            if min(b-a,d-c)/max(b-a,d-c)<.7:continue
            best=max(best,float(np.dot(feature(a,b),feature(c,d))))
    return {'repeatScore':round(best,4),'bursts':len(spans),'possibleRepeatedBurst':best>.92 and len(spans)>1}

def run(args):
    from faster_whisper import WhisperModel
    config={'version':VERSION,'model':args.model,'beam':3,'language':'explicit','prompt':None,'compute':'int8'}
    key=json.dumps(config,sort_keys=True)
    db=sqlite3.connect(q.PRIVATE/'layer2.sqlite3');db.execute('CREATE TABLE IF NOT EXISTS results(key TEXT PRIMARY KEY,data TEXT)')
    rows=q.inventory();rows=rows[:args.limit] if args.limit else rows
    model=None;results=[];started=time.time()
    def save(done=False):
        report={'config':config,'started':started,'updated':time.time(),'complete':done and not args.limit and not any(r.get('error') for r in results),'processed':len(results),'total':len(rows),'flagged':sum(bool(r['flags']) for r in results),'clips':results}
        tmp=q.PRIVATE/'layer2-report.tmp';tmp.write_text(json.dumps(report,ensure_ascii=False));tmp.replace(q.PRIVATE/'layer2-report.json')
    for i,row in enumerate(rows):
        sha=hashlib.sha256(Path(row['path']).read_bytes()).hexdigest()
        identity=hashlib.sha256((key+sha+row['bank']+row['text']).encode()).hexdigest()
        cached=db.execute('SELECT data FROM results WHERE key=?',(identity,)).fetchone()
        if cached:r=json.loads(cached[0])
        else:
            r={'id':row['id'],'sha':sha,'bank':row['bank'],'text':row['text'],'flags':[]}
            try:
                if sha!=row['expected_sha']:raise ValueError('File changed since generation')
                r.update(repeated_bursts(row['path']))
                if r.get('possibleRepeatedBurst'):r['flags'].append('possible_repeated_burst')
                if model is None:
                    print('Loading cached local '+args.model+' model',flush=True)
                    model=WhisperModel(args.model,device='cpu',compute_type='int8',cpu_threads=4,num_workers=1,local_files_only=True)
                wave,sample_rate=sf.read(row['path'],always_2d=True);wave=wave.mean(axis=1)
                divisor=gcd(sample_rate,16000);wave=resample_poly(wave,16000//divisor,sample_rate//divisor).astype(np.float32)
                segments,_=model.transcribe(wave,language=LANG[row['bank']],task='transcribe',beam_size=3,temperature=0,condition_on_previous_text=False,vad_filter=False,initial_prompt=None)
                segments=list(segments);r['transcript']=' '.join(s.text.strip() for s in segments)
                r['flags']+=transcript_flags(row['text'],r['transcript'])
                r['avgLogprob']=float(np.mean([s.avg_logprob for s in segments])) if segments else None
                if r['avgLogprob'] is not None and r['avgLogprob'] < -1:r['flags'].append('asr_low_confidence')
                if hashlib.sha256(Path(row['path']).read_bytes()).hexdigest()!=sha:raise ValueError('Audio changed during audit')
                db.execute('INSERT OR REPLACE INTO results VALUES(?,?)',(identity,json.dumps(r)));db.commit()
            except Exception as e:
                r['error']=str(e);r['flags'].append('audit_error')
                if model is None:results.append(r);save();raise
        r['id']=row['id'];results.append(r)
        if (i+1)%10==0:save();print(f'{i+1}/{len(rows)} checked; {sum(bool(x["flags"]) for x in results)} flagged',flush=True)
    save(True);db.close()
    if any(r.get('error') for r in results):raise RuntimeError('Audit errors remain; see layer2-report.json and rerun after correcting them')
    print('DONE: '+str(len(results))+' checked. Flags need listening review; transcription does not verify pronunciation.',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--model',default='medium');p.add_argument('--limit',type=int);args=p.parse_args()
    with (q.PRIVATE/'layer2.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);run(args)
