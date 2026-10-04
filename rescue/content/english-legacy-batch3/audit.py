#!/usr/bin/env python3
"""Offline candidate integrity and exposure-reservation checks; never approves audio."""
import copy
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]

def read(path):
 return json.loads(path.read_text())

def textkey(text):
 return unicodedata.normalize('NFC',text).casefold().strip()

def ipakey(ipa):
 return unicodedata.normalize('NFC',ipa).strip('/[] ').replace('ˈ','').replace('ː','').replace('ɜr','ɝ').replace('r','ɹ').replace('g','ɡ').replace(' ','')

def tokenize(ipa):
 return re.findall(r'tʃ|dʒ|eɪ|aɪ|oʊ|aʊ|ɔɪ|.',ipakey(ipa))

def audit(candidate,sources,audio,selection,main,reserved,batch2,inventory,bundle):
 errors=[]; checks=[]; combinations=0
 def need(ok,message):
  if not ok: errors.append(message)
 oldcontrasts=[c for l in main['languages'] if l['id']=='en' for c in l['contrasts']]+batch2['contrasts']
 oldids={c['id'] for c in oldcontrasts}
 oldpairs={p['id'] for c in oldcontrasts for p in c['pairs']}
 oldwords={textkey(w['text']) for c in oldcontrasts for p in c['pairs'] for w in p['words']}
 oldipas={ipakey(w['ipa']) for c in oldcontrasts for p in c['pairs'] for w in p['words']}
 reservedtext={textkey(w['text']) for s in reserved['sets'] for p in s['pairs'] for w in p['words']}
 reservedipa={ipakey(w['ipa']) for s in reserved['sets'] if s['languageId']=='en' for p in s['pairs'] for w in p['words']}
 facts={f['word']:f for f in sources['words']}
 declaredwords=[]; seenids=set(); seenpairs=set()
 need(candidate.get('languageId')=='en' and candidate.get('locale')=='en-US','wrong target locale')
 need(candidate.get('status')=='isolated-text-candidate-audio-unapproved','unsupported candidate approval')
 for c in candidate['contrasts']:
  cid=c['id']; need(cid not in oldids,'existing contrast: '+cid); need(cid not in seenids,'duplicate contrast: '+cid);seenids.add(cid)
  need(len(c['pairs'])>=3,'undersized contrast: '+cid)
  need(c.get('dialectNote'),'missing dialect note: '+cid)
  abx=c.get('abx',{})
  need(abx.get('categoryLabels')==c['phonemes'],'contrast category labels: '+cid)
  need(abx.get('presentation')=='audio-only-until-answer-or-explicit-text-assist','orthographic default: '+cid)
  need(abx.get('xMustUseDifferentPair') and abx.get('xMustExcludeBothReferenceWordTexts'),'missing X exclusions: '+cid)
  need(abx.get('matchType')=='phoneme','wrong ABX match type: '+cid)
  for p in c['pairs']:
   pid=p['id']; words=p['words']; pa=p['abx']
   need(pid not in oldpairs and pid not in seenpairs,'pair ID collision: '+pid); seenpairs.add(pid)
   need(re.fullmatch(r'en-[a-z0-9-]+',pid),'invalid pair ID: '+pid)
   need(p.get('kind')=='minimal','nonminimal candidate: '+pid)
   need(p.get('validation',{}).get('audio')=='pending-listening-review','unsupported audio approval: '+pid)
   need(len(words)==2,'pair size: '+pid)
   if len(words)!=2: continue
   need(pa.get('categoryByWordIndex')==[0,1],'category orientation: '+pid)
   need(pa.get('targetTokenIndex')==0 and pa.get('targetPosition')=='initial','target position: '+pid)
   need(pa.get('trialGroup')=='initial-singleton-v1','trial group: '+pid)
   difference=[i for i,(a,b) in enumerate(zip(words[0]['phonemes'],words[1]['phonemes'])) if a!=b]
   need(len(words[0]['phonemes'])==len(words[1]['phonemes']) and difference==[0],'one-phoneme substitution: '+pid)
   for category,w in enumerate(words):
    text=textkey(w['text']); declaredwords.append(text); fact=facts.get(w['text'])
    need(text not in oldwords,'existing training or batch2 word: '+text)
    need(ipakey(w['ipa']) not in oldipas,'existing training or batch2 IPA: '+text)
    need(text not in reservedtext,'reserved text: '+text)
    need(ipakey(w['ipa']) not in reservedipa,'reserved IPA: '+text)
    need(w['phonemes']==tokenize(w['ipa']),'tokenization: '+text)
    need(w['phonemes'][0]==c['phonemes'][category],'category phoneme: '+text)
    need(bool(w.get('meaning')),'missing meaning: '+text)
    need(fact is not None,'missing dictionary evidence: '+text)
    if fact:
     need(ipakey(w['ipa'])==fact['editorialBroadIpa'],'editorial evidence mismatch: '+text)
     need(ipakey(w['ipa']) in [ipakey(v) for v in fact['retrievedUsIpa']],'dictionary normalization mismatch: '+text)
     need(fact['referenceUrl'] in p['sources'] and fact['referenceUrl'] in c['sources'],'missing word source: '+text)
     need(fact['sourceStatus']=='pronunciation-and-selected-sense-read','unread dictionary entry: '+text)
   refs={textkey(w['text']) for w in words}
   choices=[]
   for category in (0,1):
    x=[q['words'][category] for q in c['pairs'] if q['id']!=pid and q['abx']['trialGroup']==pa['trialGroup'] and textkey(q['words'][category]['text']) not in refs]
    need(len({textkey(w['text']) for w in x})>=2,'insufficient different X words: '+pid)
    need(all(w['phonemes'][0]==c['phonemes'][category] for w in x),'X category mismatch: '+pid)
    combinations+=len(x);choices.append([w['text'] for w in x])
   checks.append(dict(pairId=pid,differingTokenIndices=difference,xChoicesByCategory=choices))
 need(len(set(declaredwords))==len(declaredwords),'duplicate batch word')
 need(set(facts)==set(declaredwords),'dictionary inventory mismatch')
 need(len(facts)==len(sources['words']),'duplicate dictionary record')
 requests=audio['words']
 need(len(requests)==len(declaredwords) and {textkey(w['text']) for w in requests}==set(declaredwords),'audio inventory mismatch')
 need(audio.get('approvedClips')==0 and audio.get('status')=='request-only-no-generation-authorized','invented audio approval')
 need(audio.get('uniqueWords')==len(set(declaredwords)) and audio.get('requiredCompleteCollectionClips')==2*len(set(declaredwords)) and audio.get('requiredProfiles')==2,'incorrect audio counts')
 for w in requests:
  pairs=[(c,p) for c in candidate['contrasts'] for p in c['pairs'] if p['id']==w['pairId']]
  if len(pairs)!=1: need(False,'audio pair binding: '+w['text']); continue
  c,p=pairs[0]; match=p['words'][w['category']] if w['category'] in (0,1) else {}
  need(w['contrastId']==c['id'] and w['text']==match.get('text') and w['ipa']==match.get('ipa'),'audio category binding: '+w['text'])
 routeids=set()
 for r in selection['routes']:
  cid=r['contrastId']; routeids.add(cid); c=next((c for c in candidate['contrasts'] if c['id']==cid),None)
  need(c is not None,'route missing contrast: '+cid)
  if c: need([ipakey(x) for x in r['legacyDeclaredPhonemes']]==c['phonemes'],'legacy phoneme mismatch: '+cid)
  current=next((x for x in inventory['routes'] if x['legacyPath']==r['legacyPath']),{})
  need(current.get('status')=='missing-contrast','legacy route no longer missing: '+r['legacyPath'])
  need('path:"'+r['legacyPath']+'",element:e.jsx('+r['legacyComponent']+',' in bundle,'legacy component binding: '+cid)
  need('slug:"'+r['legacyPath']+'",title:"'+r['legacyDeclaredTitle']+'",phonemeA:"'+r['legacyDeclaredPhonemes'][0]+'",phonemeB:"'+r['legacyDeclaredPhonemes'][1]+'"' in bundle,'legacy declaration mismatch: '+cid)
 need(routeids==seenids,'route inventory mismatch')
 return dict(passed=not errors,errors=errors,contrasts=len(candidate['contrasts']),pairs=len(checks),uniqueWords=len(set(declaredwords)),
  eligibleReferencePairXWordCategoryCombinations=combinations,requiredCompleteCollectionClips=2*len(set(declaredwords)),pairChecks=checks)

def inputs():
 return [read(HERE/x) for x in ('candidates.json','source-audit.json','audio-request.json','selection-evidence.json')]+[
  read(ROOT/'rescue/content/curriculum.json'),read(ROOT/'rescue/content/transfer-candidates.json'),
  read(ROOT/'rescue/content/english-legacy-batch2/candidates.json'),read(ROOT/'rescue/content/legacy-coverage.json'),
  (ROOT/'rescue/discovery/legacy-bundle.js').read_text()]

def run():
 original=inputs(); result=audit(*original)
 def mutation(name,change,expected):
  values=copy.deepcopy(original);change(values); errors=audit(*values)['errors']
  rejected=any(expected in e for e in errors)
  if not rejected: result['errors'].append('mutation escaped: '+name)
  return dict(name=name,rejected=rejected,expectedError=expected)
 result['mutationChecks']=[
  mutation('reversed category order',lambda d:d[0]['contrasts'][0]['pairs'][0]['words'].reverse(),'category phoneme'),
  mutation('second changed phoneme',lambda d:d[0]['contrasts'][0]['pairs'][0]['words'][1]['phonemes'].__setitem__(2,'t'),'one-phoneme substitution'),
  mutation('affricate split into two tokens',lambda d:d[0]['contrasts'][5]['pairs'][0]['words'][1].__setitem__('phonemes',['t','ʃ','ɑ','p']),'tokenization'),
  mutation('isolated X trial group',lambda d:d[0]['contrasts'][0]['pairs'][0]['abx'].__setitem__('trialGroup','isolated'),'insufficient different X words'),
  mutation('target mislabeled as final',lambda d:d[0]['contrasts'][0]['pairs'][0]['abx'].__setitem__('targetPosition','final'),'target position'),
  mutation('reserved spelling',lambda d:d[0]['contrasts'][0]['pairs'][0]['words'][0].__setitem__('text','bid'),'reserved text'),
  mutation('reserved homophone under another spelling',lambda d:d[0]['contrasts'][0]['pairs'][0]['words'][0].update(text='beed',ipa='/bid/',phonemes=['b','i','d']),'reserved IPA'),
  mutation('dictionary pronunciation altered',lambda d:d[1]['words'][0].__setitem__('retrievedUsIpa',['sɛp']),'dictionary normalization mismatch'),
  mutation('missing requested word',lambda d:d[2]['words'].pop(),'audio inventory mismatch'),
  mutation('audio category swapped',lambda d:d[2]['words'][0].__setitem__('category',1),'audio category binding'),
  mutation('invented approved clip',lambda d:d[2].__setitem__('approvedClips',1),'invented audio approval'),
  mutation('already staged contrast',lambda d:d[0]['contrasts'][0].__setitem__('id',d[6]['contrasts'][0]['id']),'existing contrast'),
  mutation('wrong legacy phoneme mapping',lambda d:d[3]['routes'][0].__setitem__('legacyDeclaredPhonemes',['s','ʃ']),'legacy phoneme mismatch'),
 ]
 result['passed']=not result['errors']
 result['date']='2026-09-28'
 result['inputSha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [HERE/'candidates.json',HERE/'source-audit.json',HERE/'audio-request.json',HERE/'selection-evidence.json']}
 result['limitation']='Offline integrity and current exclusion checks; manual source reading is recorded separately. No audio or learning efficacy is validated.'
 (HERE/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:v for k,v in result.items() if k not in ('pairChecks','inputSha256')},ensure_ascii=False,indent=2))
 return 0 if result['passed'] else 1

if __name__=='__main__':
 sys.exit(run())
