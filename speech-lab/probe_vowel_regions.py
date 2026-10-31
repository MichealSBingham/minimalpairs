"""Exploratory automatic region localization, separate from formant accuracy.

One isolated word with one vowel is assumed. Periodicity cannot distinguish a
vowel from every voiced consonant. Never use this as a general phone aligner.
"""
import hashlib
import json
from pathlib import Path
import time
import zipfile
import re

import numpy as np
from scipy import signal
from run_tracker_comparison import read_corpus, canonical, ARCHIVE, write_json
from tracker_compare import ROOT, input_gate

OUT = ROOT / 'experiments/2026-10-07-vowel-localization'
CONFIG = {'frame_samples': 640, 'hop_samples': 160,
          'minimum_periodicity': .65, 'minimum_relative_rms': .1,
          'pitch_search_hz': [70,600], 'minimum_frames': 6,
          'bridge_gap_frames': 1}


def locate(x):
    eligible, reason = input_gate(x)
    if not eligible:
        return {'accepted': False, 'reason': reason}
    starts = np.arange(0, len(x)-CONFIG['frame_samples']+1, CONFIG['hop_samples'])
    if len(starts) == 0:
        return {'accepted': False, 'reason': 'too_short_for_analysis'}
    windows = np.stack([x[s:s+CONFIG['frame_samples']] for s in starts]).astype(float)
    windows -= windows.mean(axis=1, keepdims=True)
    energy = np.mean(windows**2, axis=1)
    periodicities = []
    for w in windows:
        ac = signal.correlate(w,w,mode='full',method='fft')[len(w)-1:]
        cumulative = np.r_[0.,np.cumsum(w*w)]
        lags = np.arange(27,229)
        denominator = np.sqrt(cumulative[len(w)-lags]*(cumulative[-1]-cumulative[lags]))
        periodicities.append(float(np.max(ac[lags]/np.maximum(denominator,1e-15))))
    periodicities = np.array(periodicities)
    mask = ((periodicities >= CONFIG['minimum_periodicity']) &
            (energy >= energy.max()*CONFIG['minimum_relative_rms']**2))
    # Bridge a single rejected frame only; do not smooth across long gaps.
    bridged = mask.copy()
    bridged[1:-1] |= mask[:-2] & mask[2:]
    borders = np.diff(np.r_[False,bridged,False].astype(int))
    segments = [(a,b) for a,b in zip(np.where(borders==1)[0],np.where(borders==-1)[0])
                if b-a >= CONFIG['minimum_frames']]
    if not segments:
        return {'accepted': False,'reason':'no_sustained_periodic_region'}
    a,b = max(segments,key=lambda ab:float(np.sum(np.sqrt(energy[ab[0]:ab[1]])*
                                                     periodicities[ab[0]:ab[1]])))
    centers=(starts+CONFIG['frame_samples']/2)/16000
    return {'accepted':True,'start_s':float(centers[a]-.005),
            'end_s':float(centers[b-1]+.005),'reason':'periodic_region_unverified'}


def summarize(rows):
    accepted=[r for r in rows if r['prediction']['accepted']]
    out={'n':len(rows),'accepted':len(accepted),'coverage':len(accepted)/len(rows)}
    if not accepted:return out
    start=np.array([r['prediction']['start_s']-r['reference'][0] for r in accepted])*1000
    end=np.array([r['prediction']['end_s']-r['reference'][1] for r in accepted])*1000
    contained=[]; purity=[]
    for r in accepted:
        a,b=r['prediction']['start_s'],r['prediction']['end_s'];c,d=r['reference']
        contained.append(c<=(a+b)/2<=d)
        purity.append(max(0,min(b,d)-max(a,c))/(b-a))
    return out | {'onset_bias_ms':float(start.mean()),'offset_bias_ms':float(end.mean()),
        'onset_mae_ms':float(np.abs(start).mean()),'offset_mae_ms':float(np.abs(end).mean()),
        'onset_absolute_p95_ms':float(np.quantile(np.abs(start),.95)),
        'offset_absolute_p95_ms':float(np.quantile(np.abs(end),.95)),
        'both_boundaries_within_30ms':float(np.mean((abs(start)<=30)&(abs(end)<=30))),
        'predicted_midpoint_inside_vowel':float(np.mean(contained)),
        'mean_interval_purity':float(np.mean(purity))}


def main():
    protocol=json.loads((OUT/'protocol.json').read_text())
    assert protocol['settings']==CONFIG
    start=time.perf_counter();corpus,_=read_corpus();labels={}
    with zipfile.ZipFile(ARCHIVE) as z:
        for line in z.read('timedata.dat').decode('latin1').splitlines():
            p=line.split()
            if p and re.fullmatch('[mwbg][0-9]{2}[a-z]{2}',p[0]):
                labels[canonical(p[0])]=[float(v)/1000 for v in p[1:3]]
    rows=[]
    for c in corpus:
        rows.append({'id':c['id'],'speaker':c['speaker'],'group':c['group'],
            'vowel':c['vowel'],'reference':labels[c['id']],'prediction':locate(c['x'])})
    write_json(OUT/'rows.json',rows)
    subsets={'all':rows,'adults':[r for r in rows if r['group'] in 'mw'],
             'adult_ih_iy':[r for r in rows if r['group'] in 'mw' and r['vowel'] in ('ih','iy')]}
    write_json(OUT/'summary.json',{k:summarize(v) for k,v in subsets.items()})
    write_json(OUT/'run.json',{'status':'complete','recordings':len(rows),
        'paid_spend_usd':0,'wall_seconds':time.perf_counter()-start,
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'protocol_sha256':hashlib.sha256((OUT/'protocol.json').read_bytes()).hexdigest(),
        'archive_sha256':hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()})
    print(json.dumps({k:summarize(v) for k,v in subsets.items()},indent=2))


if __name__=='__main__':main()
