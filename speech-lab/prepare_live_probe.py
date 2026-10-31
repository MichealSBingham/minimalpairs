"""Reused adult /ih iy/ acoustic stress probe, no pronunciation labels."""
import json
from pathlib import Path
import numpy as np
from scipy.signal import butter, sosfilt
from run_tracker_comparison import read_corpus
from prepare_speaking_fixtures import root, x
import soundfile as sf

rng=np.random.default_rng(20261007)
rows=[]
corpus,_=read_corpus()
for c in corpus:
    if c['group'] not in 'mw' or c['vowel'] not in ('ih','iy'):continue
    for ref in c['references']:
        mid=round(ref['t']*16000);frame=c['x'][mid-480:mid+480]
        if len(frame)!=960:continue
        noise=rng.normal(0,1,len(frame));noise*=np.sqrt(np.mean(frame**2)/np.mean(noise**2))
        for condition,signal in [('clean',frame),('noise20db',frame+noise*.1),('noise10db',frame+noise*.316227766),('telephone',sosfilt(butter(5,[300,3400],btype='bandpass',fs=16000,output='sos'),c['x'])[mid-480:mid+480])]:
            rows.append({'id':c['id'],'group':c['group'],'condition':condition,'ref':ref,'sr':16000,'samples':signal.tolist()})
controls=[]
for sr in (16000,44100,48000):
    t=np.arange(round(sr*.06))/sr
    for kind,samples in [('silence',t*0),('white_noise',rng.normal(0,.03,len(t))),('tone220',.1*np.sin(2*np.pi*220*t)),('tone1000',.1*np.sin(2*np.pi*1000*t)),('clipping',np.clip(2*np.sin(2*np.pi*130*t),-1,1))]:
        controls.append({'id':f'{kind}-{sr}','sr':sr,'samples':samples.tolist()})
(root/'live-probe.json').write_text(json.dumps({'rows':rows,'controls':controls}))
# Actual credited word repetitions exercise moving estimates and subsequent silence.
stream=np.r_[np.zeros(16000),np.tile(np.r_[x,np.zeros(4000)],4),np.zeros(96000)]
sf.write(root/'live-capture.wav',stream,16000)
print(f'Prepared {len(rows)} acoustic frames and {len(controls)} controls.')

noise=rng.normal(0,.035,len(stream))
sf.write(root/'live-noisy.wav',stream+noise,16000)
