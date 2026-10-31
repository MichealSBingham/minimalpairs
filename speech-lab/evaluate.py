from pathlib import Path
import json, time, hashlib
import numpy as np
from scipy.stats import pearsonr
from engine import Engine, decode_audio, ROOT, PAIRS, normalize_phone

REPO=ROOT.parent
ARPA={'AA':['ɑ'],'AE':['æ'],'AH':['ʌ'],'AO':['ɔ'],'AW':['aʊ'],'AY':['aɪ'],
 'B':['b'],'CH':['tʃ'],'D':['d'],'DH':['ð'],'EH':['ɛ'],'ER':['ɚ'],'EY':['eɪ'],
 'F':['f'],'G':['ɡ'],'HH':['h'],'IH':['ɪ'],'IY':['i'],'JH':['dʒ'],'K':['k'],
 'L':['l'],'M':['m'],'N':['n'],'NG':['ŋ'],'OW':['oʊ'],'OY':['ɔɪ'],'P':['p'],
 'R':['ɹ'],'S':['s'],'SH':['ʃ'],'T':['t'],'TH':['θ'],'UH':['ʊ'],'UW':['u'],
 'V':['v'],'W':['w'],'Y':['j'],'Z':['z'],'ZH':['ʒ']}

def canonical(phone):
    if phone=='AH0': return ['ə']
    return ARPA[phone.rstrip('012')]

def align(ref,hyp):
    d=np.zeros((len(ref)+1,len(hyp)+1),dtype=int)
    d[:,0]=np.arange(len(ref)+1);d[0,:]=np.arange(len(hyp)+1)
    for i in range(1,len(ref)+1):
        for j in range(1,len(hyp)+1):
            d[i,j]=min(d[i-1,j]+1,d[i,j-1]+1,d[i-1,j-1]+(ref[i-1]!=hyp[j-1]))
    i,j=len(ref),len(hyp); operations=[]
    while i or j:
        if i and j and d[i,j]==d[i-1,j-1]+(ref[i-1]!=hyp[j-1]):
            operations.append((i-1,j-1,ref[i-1]!=hyp[j-1]));i-=1;j-=1
        elif i and d[i,j]==d[i-1,j]+1:
            operations.append((i-1,None,True));i-=1
        else:
            operations.append((None,j-1,True));j-=1
    return int(d[-1,-1]),list(reversed(operations))

def references():
    rows=[]
    for folder in ['human-fr-u-y','human-en-i-ih']:
        manifest=json.loads((REPO/'rescue/app/public/audio'/folder/'manifest.json').read_text())
        for clip in manifest['clips']:
            pair_id=next(k for k,p in PAIRS.items() if clip['text'] in p['words'])
            path=REPO/'rescue/app/public'/clip['url'].lstrip('/')
            rows.append({'id':clip['id'],'word':clip['text'],'pair':pair_id,
                'speaker':clip.get('speaker',clip['voiceId']), 'path':str(path),
                'source':clip['sourcePage'],'license':clip['license'],
                'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                'phonetic_listening_verified':clip.get('phoneticListeningVerified',False)})
    return rows

def main():
    model=Engine(); rng=np.random.default_rng(20261004); rows=[]
    for c in references():
        audio=decode_audio(c['path']);target=PAIRS[c['pair']]['words'].index(c['word'])
        r=model.analyze(audio,c['pair'],target)
        noise=rng.normal(0,1,len(audio));noise*=np.sqrt(np.mean(audio**2))/10
        degraded=model.analyze((audio+noise).astype('float32'),c['pair'],target,False)
        rows.append({**c,'path':str(Path(c['path']).relative_to(REPO)), 'clean':r,'snr20':degraded})
        print(c['word'],c['speaker'],r['phones'],r['status'],flush=True)
    controls=[]
    inputs={'silence':np.zeros(16000),'noise':rng.normal(0,.04,16000),
            'clipping':np.sign(np.sin(np.arange(16000)*2*np.pi*220/16000)),
            'tone220':.1*np.sin(np.arange(16000)*2*np.pi*220/16000)}
    for name,a in inputs.items():controls.append({'name':name,**model.analyze(a.astype('float32'))})
    for c in references():
        other='sheep-ship' if PAIRS[c['pair']]['language']=='French' else 'tout-tu'
        controls.append({'name':'wrong-exercise:'+c['id'],**model.analyze(decode_audio(REPO/c['path'] if not Path(c['path']).is_absolute() else c['path']),other,0,False)})
    (ROOT/'artifacts/contrast-results.json').write_text(json.dumps({'rows':rows,'controls':controls},indent=2,ensure_ascii=False))
    print('Contrast evaluation saved',flush=True)
    learner=[]; counts={'tp':0,'fp':0,'tn':0,'fn':0,'middle':0,'insertions':0}
    manifest=json.loads((ROOT/'artifacts/benchmark-manifest.json').read_text())
    for c in manifest:
        audio=decode_audio(ROOT/c['path']); start=time.perf_counter(); r=model.recognize(audio)
        ref=[]; labels=[]
        for w in c['score']['words']:
            for p,s in zip(w['phones'],w['phones-accuracy']):
                converted=canonical(p);ref.extend(converted);labels.extend([s]*len(converted))
        hyp=[normalize_phone(p) for p in r['phones']]
        distance,ops=align(ref,hyp); local={k:0 for k in counts}
        for i,j,wrong in ops:
            if i is None:local['insertions']+=1;continue
            label=labels[i]
            if .5<label<1.5:local['middle']+=1;continue
            actual=label<=.5
            local['tp' if actual and wrong else 'fn' if actual else 'fp' if wrong else 'tn']+=1
        for k in counts:counts[k]+=local[k]
        learner.append({'id':c['id'],'speaker':c['speaker'],'age':c['age'],'gender':c['gender'],
            'text':c['score']['text'],'human_accuracy':c['score']['accuracy'],
            'similarity':max(0,1-distance/max(1,len(ref))), 'reference_phones':ref,
            'recognized_phones':hyp,'edit_distance':distance,'counts':local,
            'latency_s':round(time.perf_counter()-start,3)})
        if len(learner)%10==0:print('Learner utterances',len(learner),flush=True)
    x=np.array([r['similarity'] for r in learner]);y=np.array([r['human_accuracy'] for r in learner])
    speakers=sorted(set(r['speaker'] for r in learner)); by={s:[i for i,r in enumerate(learner) if r['speaker']==s] for s in speakers}
    boot=[]
    for _ in range(1000):
        indices=[i for s in rng.choice(speakers,len(speakers),replace=True) for i in by[s]]
        if np.std(x[indices]) and np.std(y[indices]):boot.append(float(pearsonr(x[indices],y[indices]).statistic))
    summary={'n':len(learner),'speakers':len(speakers),'sentence_similarity_pearson':float(pearsonr(x,y).statistic),
        'speaker_bootstrap_95ci':np.quantile(boot,[.025,.975]).tolist(), 'phone_counts':counts,
        'phone_error_precision':counts['tp']/max(1,counts['tp']+counts['fp']),
        'phone_error_recall':counts['tp']/max(1,counts['tp']+counts['fn']),
        'phone_false_correction_rate':counts['fp']/max(1,counts['fp']+counts['tn']),
        'latency_p50_s':float(np.median([r['latency_s'] for r in learner])),
        'latency_p95_s':float(np.quantile([r['latency_s'] for r in learner],.95)),
        'limitations':'Small fixed test sample; naive diagnostic mapping/alignment, not a trained assessor. No tuning on results. One L1, read English. Not independent of unknown upstream training overlap.'}
    (ROOT/'artifacts/learner-results.json').write_text(json.dumps({'summary':summary,'rows':learner},indent=2,ensure_ascii=False))
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
