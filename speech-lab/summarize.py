import json, math
from engine import ROOT

def wilson(errors,n,z=1.96):
    p=errors/n;den=1+z*z/n
    center=(p+z*z/(2*n))/den
    delta=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den
    return [max(0,center-delta),min(1,center+delta)]

def main():
    c=json.loads((ROOT/'artifacts/contrast-results.json').read_text());l=json.loads((ROOT/'artifacts/learner-results.json').read_text())
    def aggregate(rows,key):
        accepted=[x for x in rows if x[key]['status'] in ['target-evidence','contrast-evidence']]
        wrong=sum(x[key]['candidate_winner']!=x['word'] for x in accepted)
        return {'n':len(rows),'ranking_correct':sum(x[key].get('candidate_winner')==x['word'] for x in rows),
            'gated_n':len(accepted),'gated_wrong':wrong,'coverage':len(accepted)/len(rows),
            'accepted_error_wilson95':wilson(wrong,len(accepted)) if accepted else None}
    summary={'created':'2026-10-04','paid_spend_usd':0,'budget_usd':100,
        'contrast':{key:aggregate(c['rows'],key) for key in ['clean','snr20']},
        'by_language':{lang:aggregate([r for r in c['rows'] if ('fr-' in r['path'])==(lang=='French')],'clean') for lang in ['French','English']},
        'controls':{'n':len(c['controls']),'withheld':sum(r['status'] in ['retry','uncertain'] for r in c['controls'])},
        'learner':l['summary'],
        'formants':json.loads((ROOT/'artifacts/formant-results.json').read_text())['report'],
        'decision':'No-go for automatic correctness grading. Go for private evidence/replay prototype and dedicated scorer comparison. No regional accent classifier trained.',
        'limitations':['Word-label metadata is not a phonetic correctness label.','24 recordings are only four speakers; Wilson intervals assume independent trials and are optimistic here.','80 learner utterances contain only 25 clearly incorrect aligned reference phones under the stated label threshold.','Raw two-choice ranking is not open-set recognition.','SNR20 uses the same recordings, not new independent observations.','No live microphone or learning-outcome validation.']}
    (ROOT/'artifacts/summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps({k:v for k,v in summary.items() if k!='formants'},indent=2))

if __name__=='__main__':main()
