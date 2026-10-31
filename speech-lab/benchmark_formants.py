"""Compare fixed Praat configurations on the PREVIOUSLY USED Hillenbrand frames."""
import json,time
import numpy as np
import parselmouth
from engine import ROOT

def main():
    clips=json.loads((ROOT.parent/'accuracy-lab/data/hillenbrand/benchmark-clips.json').read_text())
    rows=[]
    for c in clips:
        snd=parselmouth.Sound(np.asarray(c['samples']),c['sr']); estimates={}
        for ceiling in [5000,5500]:
            try:
                f=snd.to_formant_burg(time_step=.005,max_number_of_formants=5,maximum_formant=ceiling,window_length=.02)
                f1,f2=[f.get_value_at_time(i,snd.duration/2) for i in [1,2]]
                estimates[str(ceiling)]={'f1':float(f1),'f2':float(f2),'ok':bool(np.isfinite([f1,f2]).all())}
            except Exception: estimates[str(ceiling)]={'ok':False}
        a,b=estimates['5000'],estimates['5500']; good=a['ok'] and b['ok']
        if good:good=abs(a['f1']-b['f1'])<=120 and abs(a['f2']-b['f2'])<=220
        estimates['consensus']={'ok':bool(good)}
        if good:estimates['consensus'].update(f1=(a['f1']+b['f1'])/2,f2=(a['f2']+b['f2'])/2)
        rows.append({k:c[k] for k in ['id','group','ref_f1','ref_f2']}|{'estimates':estimates})
    report={}
    for method in ['5000','5500','consensus']:
        report[method]={}
        for group in ['all','m','w','b','g']:
            selected=[r for r in rows if group=='all' or r['group']==group]
            ok=[r for r in selected if r['estimates'][method]['ok']]
            e1=[abs(r['ref_f1']-r['estimates'][method]['f1']) for r in ok]
            e2=[abs(r['ref_f2']-r['estimates'][method]['f2']) for r in ok]
            report[method][group]={'n':len(selected),'accepted':len(ok),'coverage':len(ok)/len(selected),
                'f1_mae':float(np.mean(e1)),'f2_mae':float(np.mean(e2)),
                'f1_p95':float(np.quantile(e1,.95)),'f2_p95':float(np.quantile(e2,.95))}
    result={'status':'Exploratory comparison on reused corpus; no held-out claim. Praat 40ms effective window, midpoint of existing 50ms clips. Fixed settings, no per-speaker selection. Not directly identical to browser LPC preprocessing.', 'report':report,'rows':rows}
    (ROOT/'artifacts/formant-results.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(report,indent=2))

if __name__=='__main__': main()
