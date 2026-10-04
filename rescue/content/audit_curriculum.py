"""Structural/phonemic consistency checks; not a pronunciation validator."""
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parent
data=json.loads((ROOT/'curriculum.json').read_text())
seen=set(); rows=[]; failures=[]; alignment_rows=[]; abx_failures=[]; valid_cross_word_trials=0
for language in data['languages']:
    for contrast in language['contrasts']:
        for pair in contrast['pairs']:
            assert pair['id'] not in seen, pair['id']
            seen.add(pair['id'])
            assert len(pair['words'])==2 and pair['sources']
            a,b=pair['words']; x,y=a['phonemes'],b['phonemes']
            differences=[dict(position=i,left=p,right=q) for i,(p,q) in enumerate(zip(x,y)) if p!=q]
            same_length=len(x)==len(y)
            if pair['kind']=='stress':
                passed=same_length and not differences and a['ipa']!=b['ipa']
                rule='Same segment sequence; marked stress position differs.'
            elif pair['kind']=='tone':
                passed=same_length and len(differences)==1 and differences[0]['left'].startswith('T') and differences[0]['right'].startswith('T')
                rule='One tone substitution; segment sequence unchanged.'
            else:
                passed=same_length and len(differences)==1
                rule='One segment substitution in the editorial phoneme tokenization.'
            if not passed: failures.append(pair['id'])
            abx=contrast['abx']; idx=pair['abx']['targetTokenIndex']
            if abx['matchType']=='phoneme':
                aligned=idx is not None and [x[idx],y[idx]]==contrast['phonemes']
            elif abx['matchType']=='tone':
                aligned=idx is not None and [x[idx],y[idx]]==['T'+name.split()[-1] for name in contrast['phonemes']]
            elif contrast['id']=='it-length':
                aligned=idx is not None and y[idx]==x[idx]+'ː'
            elif contrast['id']=='ru-hard-soft':
                aligned=idx is not None and y[idx]==x[idx]+'ʲ'
            elif abx['matchType']=='stress':
                stress_positions=[len(re.findall('[aeiou]',w['ipa'].split('ˈ')[0])) for w in [a,b]]
                vowel_counts=[len(re.findall('[aeiou]',w['ipa'])) for w in [a,b]]
                aligned=stress_positions==[0,1] and vowel_counts==[2,2]
            else: aligned=False
            candidates=[other for other in contrast['pairs'] if other['id']!=pair['id'] and other['abx']['trialGroup']==pair['abx']['trialGroup']]
            refs={a['text'],b['text']}
            viable=[other for other in candidates if all(w['text'] not in refs for w in other['words'])]
            if not aligned or not viable: abx_failures.append(pair['id'])
            valid_cross_word_trials+=2*len(viable)
            alignment_rows.append(dict(id=pair['id'],categoryOrderAligned=aligned,targetPosition=pair['abx']['targetPosition'],eligibleXPairIds=[other['id'] for other in viable]))
            rows.append(dict(id=pair['id'],language=language['id'],words=[a['text'],b['text']],kind=pair['kind'],passed=passed,rule=rule,differences=differences))
report=dict(date='2026-09-28',languages=len(data['languages']),pairs=len(rows),passed=len(rows)-len(failures),failures=failures,
    limitation='Checks internal consistency of hand-authored transcriptions. It cannot establish real-word status, independent IPA correctness, dialect match, naturalness, human origin or recorded pronunciation. Those require external evidence and listening review.',rows=rows)
abx_report=dict(date='2026-09-28',pairs=len(alignment_rows),contrasts=sum(len(l['contrasts']) for l in data['languages']),
    passed=len(alignment_rows)-len(abx_failures),failures=abx_failures,validCrossWordCategoryTrials=valid_cross_word_trials,
    limitation='Checks authored phoneme/category order and different-word candidate availability, not audio pronunciation or learning efficacy. Display A/B roles may be swapped independently of word category index.',rows=alignment_rows)
(ROOT/'abx-audit.json').write_text(json.dumps(abx_report,ensure_ascii=False,indent=2)+'\n')
print('ABX category/candidate audit:',json.dumps({k:v for k,v in abx_report.items() if k!='rows'},ensure_ascii=False))
(ROOT/'pair-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='rows'},ensure_ascii=False,indent=2))
raise SystemExit(bool(failures or abx_failures))
