"""Frozen exploratory comparison; see experiments/2026-10-07-*/protocol.json."""
import argparse
from collections import defaultdict
import hashlib
import io
import json
from pathlib import Path
import re
import time
import zipfile

import numpy as np
from scipy import signal
import soundfile as sf
import torch

from tracker_compare import (ROOT, MODEL, HeatmapTracker, BurgBank, estimates,
                             prepare_audio, input_gate)

OUT = ROOT / 'experiments/2026-10-07-tracker-comparison'
ARCHIVE = ROOT.parent / 'accuracy-lab/data/hillenbrand/h95-alldata.zip'
METHODS = ('burg5500', 'burg_two_ceiling', 'heatmap', 'cross_method_fixed',
           'cross_method_multiceiling')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, obj):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(obj, indent=2, allow_nan=False) + '\n')
    temp.replace(path)


def canonical(name):
    # Archive spelling has both ei and ey for the same hayed label.
    stem = Path(name).stem.lower()
    return stem[:3] + ('ey' if stem[3:] == 'ei' else stem[3:])


def read_corpus():
    archive = zipfile.ZipFile(ARCHIVE)
    timedata, acoustic = {}, {}
    for name, dest in [('timedata.dat', timedata), ('bigdata.dat', acoustic)]:
        for line in archive.read(name).decode('latin1').splitlines():
            parts = line.split()
            if parts and re.fullmatch('[mwbg][0-9]{2}[a-z]{2}', parts[0]):
                dest[canonical(parts[0])] = list(map(float, parts[1:]))
    audio, origins = {}, {}
    for nested in ('men.zip', 'women.zip', 'kids.zip'):
        z = zipfile.ZipFile(io.BytesIO(archive.read(nested)))
        for name in z.namelist():
            if name.lower().endswith('.wav'):
                key = canonical(name)
                if key in audio:
                    raise ValueError('Duplicate corpus id: ' + key)
                audio[key] = z.read(name)
                origins[key] = nested + '/' + name
    corpus, excluded = [], []
    for key in sorted(set(acoustic) | set(timedata) | set(audio)):
        if not all(key in d for d in (acoustic, timedata, audio)):
            excluded.append({'id': key, 'reason': 'missing_matching_audio_or_annotations'})
            continue
        a, timing = acoustic[key], timedata[key]
        x, sr = sf.read(io.BytesIO(audio[key]), dtype='float32')
        if x.ndim != 1:
            raise ValueError('Unexpected multichannel corpus recording.')
        start, end = np.array(timing[:2]) / 1000
        references = []
        for fraction, offset in ((.2, 8), (.5, 17), (.8, 26)):
            # bigdata columns excluding file id: 0 duration, 1 f0, 2-4 steady,
            # 5-7 at 10%, 8-10 at 20%, ..., 26-28 at 80%.
            pair = a[offset:offset+2]
            if len(pair) != 2 or min(pair) <= 0:
                excluded.append({'id': key, 'fraction': fraction, 'reason': 'unmeasurable_reference'})
                continue
            references.append({'fraction': fraction, 't': float(start + fraction*(end-start)),
                               'f1': pair[0], 'f2': pair[1]})
        corpus.append({'id': key, 'speaker': key[:3], 'group': key[0],
                       'vowel': key[3:], 'ref_f0': a[1], 'x': prepare_audio(x, sr),
                       'references': references, 'audio_sha256': digest(audio[key]),
                       'origin': origins[key]})
    return corpus, excluded


def verify_upstream(tracker):
    x, sr = sf.read(MODEL / 'test_dir/sx12.wav', dtype='float32')
    times, pred = tracker.predict(prepare_audio(x, sr))
    published = np.loadtxt(MODEL / 'predictions/sx12.pred')
    if len(times) != len(published):
        raise AssertionError('Upstream verification frame count mismatch')
    difference = np.abs(pred - published[:, 1:4])
    report = {'frames': len(times), 'max_difference_hz': float(difference.max()),
              'mean_difference_hz': float(difference.mean()),
              'within_one_bin_fraction': float(np.mean(difference < 32.2)),
              'note': 'Published file truncates Hz to integer; float differences <1 Hz are expected.'}
    # A tiny numerical difference can change a tied argmax by a bin, but anything
    # more than 1% of bins changing requires an adapter investigation.
    if np.mean(difference > 1.01) > .01:
        raise AssertionError('Adapter differs from published predictions: ' + str(report))
    return report


def analyze(tracker, c, condition='clean', x=None):
    x = c['x'] if x is None else x
    start = time.perf_counter()
    nt, nf = tracker.predict(x)
    neural_ms = (time.perf_counter()-start)*1000
    start = time.perf_counter()
    bank = BurgBank(x)
    burg_ms = (time.perf_counter()-start)*1000
    rows = []
    for ref in c['references']:
        neural = np.array([np.interp(ref['t'], nt, nf[:, i]) for i in (0, 1)])
        rows.append({k: c[k] for k in ('id', 'speaker', 'group', 'vowel', 'ref_f0')} |
                    {'condition': condition, 'reference': ref,
                     'methods': estimates(bank.at(ref['t']), neural)})
    eligible, reason = input_gate(x)
    timing = {'id': c['id'], 'condition': condition, 'audio_s': len(x)/16000,
              'heatmap_ms': neural_ms, 'burg_bank_ms': burg_ms,
              'input_gate': eligible, 'input_gate_reason': reason}
    return rows, timing


def metrics(rows, method, bootstrap=True):
    accepted = [r for r in rows if r['methods'][method]['accepted']]
    output = {'n': len(rows), 'accepted': len(accepted),
              'speakers': len({r['speaker'] for r in rows}),
              'coverage': len(accepted)/len(rows) if rows else None}
    if not accepted:
        return output | {k: None for k in ('f1_mae_hz','f2_mae_hz','f1_p95_hz',
                        'f2_p95_hz','large_error_rate','good_measurement_yield')}
    errors = np.array([[abs(r['methods'][method][f]-r['reference'][f]) for f in ('f1','f2')]
                       for r in accepted])
    bad = np.any(errors > np.array([150,300]), axis=1)
    output |= {'f1_mae_hz': float(errors[:,0].mean()), 'f2_mae_hz': float(errors[:,1].mean()),
               'f1_median_hz': float(np.median(errors[:,0])), 'f2_median_hz': float(np.median(errors[:,1])),
               'f1_p95_hz': float(np.quantile(errors[:,0], .95)),
               'f2_p95_hz': float(np.quantile(errors[:,1], .95)),
               'large_errors': int(bad.sum()), 'large_error_rate': float(bad.mean()),
               'good_measurement_yield': int((~bad).sum())/len(rows)}
    if bootstrap:
        # Resample speakers, not individual frames. Keep zero-accepted speakers.
        speakers = sorted({r['speaker'] for r in rows})
        sums = defaultdict(float); counts = defaultdict(int)
        for r, err in zip(accepted, errors):
            sums[r['speaker']] += err[1]; counts[r['speaker']] += 1
        a = np.array([sums[s] for s in speakers]); b = np.array([counts[s] for s in speakers])
        rng = np.random.default_rng(20261007)
        idx = rng.integers(0,len(speakers),size=(600,len(speakers)))
        den = b[idx].sum(axis=1); num = a[idx].sum(axis=1)
        values = num[den > 0]/den[den > 0]
        output['f2_mae_speaker_bootstrap95_hz'] = np.quantile(values,[.025,.975]).tolist()
    return output


def summarize(rows):
    subsets = {'all': rows, 'adults': [r for r in rows if r['group'] in 'mw'],
               'ih_iy': [r for r in rows if r['vowel'] in ('ih','iy')],
               'adult_ih_iy': [r for r in rows if r['group'] in 'mw' and r['vowel'] in ('ih','iy')]}
    subsets.update({g: [r for r in rows if r['group']==g] for g in 'mwbg'})
    subsets.update({f'f0_{lo}_{hi}': [r for r in rows if lo <= r['ref_f0'] < hi]
                    for lo, hi in ((0,150),(150,250),(250,1000))})
    return {name: {m: metrics(sub,m) for m in METHODS} for name, sub in subsets.items()}


def stress_subset(corpus):
    selected = []
    for group in 'mwbg':
        for vowel in ('ih','iy'):
            candidates = [c for c in corpus if c['group']==group and c['vowel']==vowel]
            selected += sorted(candidates,key=lambda c:digest(('stress-v1:'+c['id']).encode()))[:3]
    return selected


def run_stress(tracker, corpus):
    rows, timings = [], []
    for c in stress_subset(corpus):
        x=c['x']; rng=np.random.default_rng(int(digest(c['id'].encode())[:8],16))
        noise=rng.normal(size=len(x)); noise*=np.sqrt(np.mean(x*x)/np.mean(noise*noise))/10
        filt=signal.butter(4,[300,3400],btype='bandpass',fs=16000,output='sos')
        variants={'gain_0.1':x*.1, 'seeded_white_noise_snr20':(x+noise).astype(np.float32),
                  'roundtrip_44100':prepare_audio(signal.resample_poly(x,441,160),44100)[:len(x)],
                  'roundtrip_48000':prepare_audio(signal.resample_poly(x,3,1),48000)[:len(x)],
                  'telephone_band_300_3400':signal.sosfilt(filt,x).astype(np.float32)}
        for name, audio in variants.items():
            r,t=analyze(tracker,c,name,audio);rows+=r;timings.append(t)
        print('stress',c['id'],flush=True)
    return rows, timings


def controls(tracker):
    t=np.arange(16000)/16000; rng=np.random.default_rng(7)
    signals={'silence':np.zeros(len(t)), 'white_noise':rng.normal(0,.03,len(t)),
             '220Hz_sine':.1*np.sin(2*np.pi*220*t), '440Hz_sine':.1*np.sin(2*np.pi*440*t),
             'clipped_periodic':np.clip(2*np.sin(2*np.pi*130*t),-1,1)}
    output=[]
    for name,x in signals.items():
        x=x.astype(np.float32); good, reason=input_gate(x)
        _, pred=tracker.predict(x)
        # Deliberately record that neural trackers produce coordinates even on
        # invalid inputs. These coordinates must not be treated as confidence.
        output.append({'name':name,'eligible':good,'reason':reason,
                       'raw_neural_midpoint_hz':pred[len(pred)//2,:2].tolist()})
    return output


def streaming_probe(tracker, corpus):
    output=[]
    for group in 'mwbg':
        c=next(c for c in stress_subset(corpus) if c['group']==group)
        ref=next(r for r in c['references'] if r['fraction']==.5)
        nt, nf=tracker.predict(c['x'])
        full=[float(np.interp(ref['t'],nt,nf[:,i])) for i in (0,1)]
        for future in (0.,.1,.25,.45):
            end=min(len(c['x']),int((ref['t']+future)*16000))
            start=time.perf_counter();nt,nf=tracker.predict(c['x'][:end])
            pair=[float(np.interp(ref['t'],nt,nf[:,i])) for i in (0,1)]
            output.append({'id':c['id'],'requested_future_ms':future*1000,
                'available_future_ms':max(0,(end/16000-ref['t'])*1000),
                'cpu_ms':(time.perf_counter()-start)*1000,'full_pair_hz':full,'prefix_pair_hz':pair,
                'absolute_change_hz':np.abs(np.array(pair)-full).tolist()})
    return output


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--verify-only',action='store_true')
    args=parser.parse_args();torch.set_num_threads(4)
    tracker=HeatmapTracker(); verification=verify_upstream(tracker)
    print('upstream_verification',json.dumps(verification),flush=True)
    if args.verify_only:
        return
    corpus, excluded=read_corpus()
    manifest={'archive_sha256':digest(ARCHIVE.read_bytes()),
              'protocol_sha256':digest((OUT/'protocol.json').read_bytes()),
              'adapter_sha256':digest((ROOT/'tracker_compare.py').read_bytes()),
              'runner_sha256':digest(Path(__file__).read_bytes()),
              'torch':torch.__version__, 'parselmouth':__import__('parselmouth').__version__,
              'cpu_threads':4,'excluded':excluded,
              'model_files':{str(p.relative_to(MODEL)):digest(p.read_bytes())
                             for p in MODEL.rglob('*') if p.is_file() and '__pycache__' not in str(p)},
              'recordings':[{k:v for k,v in c.items() if k!='x'} for c in corpus]}
    write_json(OUT/'manifest.json',manifest)
    rows=[]; timings=[]; start=time.perf_counter()
    with (OUT/'clean-rows.jsonl').open('w') as f:
        for i,c in enumerate(corpus):
            r,t=analyze(tracker,c);rows+=r;timings.append(t)
            for row in r:f.write(json.dumps(row,allow_nan=False)+'\n')
            if (i+1)%25==0:print('clean',i+1,'/',len(corpus),'elapsed_s',round(time.perf_counter()-start),flush=True)
    write_json(OUT/'clean-summary.json',summarize(rows))
    stress_rows, stress_timings=run_stress(tracker,corpus)
    write_json(OUT/'stress-rows.json',stress_rows)
    stress_summary={condition:{m:metrics([r for r in stress_rows if r['condition']==condition],m)
                               for m in METHODS} for condition in sorted({r['condition'] for r in stress_rows})}
    ids={c['id'] for c in stress_subset(corpus)}
    stress_summary['matched_clean']={m:metrics([r for r in rows if r['id'] in ids],m) for m in METHODS}
    write_json(OUT/'stress-summary.json',stress_summary)
    write_json(OUT/'timings.json',timings+stress_timings)
    write_json(OUT/'controls.json',controls(tracker))
    write_json(OUT/'streaming-probe.json',streaming_probe(tracker,corpus))
    latency={k:{'p50':float(np.median([t[k] for t in timings])),
                'p95':float(np.quantile([t[k] for t in timings],.95))}
             for k in ('heatmap_ms','burg_bank_ms')}
    write_json(OUT/'run.json',{'status':'complete','verification':verification,
        'recordings':len(corpus),'reference_points':len(rows),'latency_ms':latency,
        'wall_seconds':time.perf_counter()-start,'paid_spend_usd':0,
        'limitations':['reused corpus, no independent holdout','oracle vowel boundaries',
                       'noncausal offline neural model','no expert correctness or learning evaluation',
                       'transformed audio is not independent device data']})
    print('COMPLETE',json.dumps(latency),flush=True)


if __name__=='__main__':
    main()
