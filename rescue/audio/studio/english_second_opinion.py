"""Local second recognizer for the English peer-disagreement shortlist. No approvals/deletions."""
import json
from pathlib import Path
from math import gcd
import soundfile as sf
import numpy as np
from scipy.signal import resample_poly
from faster_whisper import WhisperModel
import quality as q
from audit_layer2 import normalize
p=q.PRIVATE
model=WhisperModel('base.en',device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True)
rows={r['id']:r for r in q.inventory()};items=json.loads((p/'english-discrepancy-candidates.json').read_text());out=[]
for c in items:
 r=rows.get(c['id'])
 if not r or r['expected_sha']!=c['sha']:continue
 x,sr=sf.read(r['path'],always_2d=True);g=gcd(sr,16000);x=resample_poly(x.mean(axis=1),16000//g,sr//g).astype(np.float32)
 seg,_=model.transcribe(x,language='en',beam_size=3,temperature=0,condition_on_previous_text=False,vad_filter=False)
 heard=' '.join(s.text.strip() for s in seg)
 c={**c,'secondTranscript':heard,'secondMismatch':normalize(heard)!=normalize(c['text'])};out.append(c)
 (p/'english-second-opinion.json').write_text(json.dumps(out,ensure_ascii=False))
 print(c['text'],repr(c['transcript']),repr(heard),flush=True)
