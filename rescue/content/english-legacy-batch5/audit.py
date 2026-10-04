#!/usr/bin/env python3
"""Offline integrity/exclusion checks, including dialect boundaries; no audio approval."""
import copy
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
EXPECTED={
 'en-dh-d':('en-US','initial','initial-singleton-v1',['ð','d']),
 'en-dh-z':('en-US','final','final-fricative-after-i-v1',['ð','z']),
 'en-v-b':('en-US','initial','initial-singleton-v1',['v','b']),
 'en-thought-lot-gb':('en-GB','medial','nonrhotic-gb-medial-vowel-before-t-v1',['ɔː','ɒ']),
}
def read(path): return json.loads(path.read_text())
def textkey(s): return unicodedata.normalize('NFC',s).casefold().strip()
def ipa(s): return unicodedata.normalize('NFC',s).strip('/[] ').replace('r','ɹ').replace('g','ɡ').replace(' ','')
def exposure_ipa(s): return ipa(s).replace('ˈ','').replace('ˌ','').replace('ː','').replace('ɜɹ','ɝ')
def tokens(s): return re.findall(r'tʃ|dʒ|eɪ|aɪ|oʊ|aʊ|ɔɪ|[a-zɑɒɔɛɪʊʌəɜɝɹŋʃʒθð]ː|.',ipa(s).replace('ˈ','').replace('ˌ',''))
def stress(s): return [(i,c) for i,c in enumerate(ipa(s)) if c in 'ˈˌ']

def audit(candidate,sources,audio,selection,main,reserved,prior,inventory,bundle):
 errors=[]; checks=[]; combinations=0
 def need(ok,message):
  if not ok: errors.append(message)
 old=[c for l in main['languages'] if l['id']=='en' for c in l['contrasts']]+prior['contrasts']
 oldids={c['id'] for c in old}; oldpairs={p['id'] for c in old for p in c['pairs']}
 oldwords={textkey(w['text']) for c in old for p in c['pairs'] for w in p['words']}
 oldipas={exposure_ipa(w['ipa']) for c in old for p in c['pairs'] for w in p['words']}
 reservedtext={textkey(w['text']) for s in reserved['sets'] for p in s['pairs'] for w in p['words']}
 reservedipa={exposure_ipa(w['ipa']) for s in reserved['sets'] if s['languageId']=='en' for p in s['pairs'] for w in p['words']}
 facts={f['word']:f for f in sources['words']}; allwords=[]; seenids=set(); seenpairs=set(); wordlocales={}
 need(candidate.get('languageId')=='en' and candidate.get('locale') is None and candidate.get('requiredLocales')==['en-US','en-GB'],'mixed batch incorrectly has one locale')
 need(candidate.get('status')=='isolated-text-candidate-audio-unapproved','unsupported candidate approval')
 for c in candidate['contrasts']:
  cid=c['id']; need(cid not in oldids,'existing contrast: '+cid); need(cid not in seenids,'duplicate contrast: '+cid); seenids.add(cid)
  expected=EXPECTED.get(cid); need(expected is not None,'unexpected contrast: '+cid)
  if expected is None: continue
  locale,position,group,phonemes=expected
  need(c.get('requiredAudioLocale')==locale,'contrast locale mismatch: '+cid)
  need(c.get('phonemes')==phonemes,'contrast phonemes: '+cid)
  need(len(c['pairs'])>=3,'undersized contrast: '+cid)
  need(bool(c.get('dialectNote')),'missing dialect note: '+cid)
  need(c.get('integrationStatus')==('blocked-per-contrast-dialect-profile-support-and-audio-review' if locale=='en-GB' else 'isolated-awaiting-audio-review-and-integration'),'integration gate: '+cid)
  abx=c.get('abx',{})
  need(abx.get('categoryLabels')==phonemes and abx.get('matchType')=='phoneme','contrast category labels: '+cid)
  need(abx.get('profilesMustShareLocale')==locale,'cross-dialect profiles: '+cid)
  need(abx.get('presentation')=='audio-only-until-answer-or-explicit-text-assist','orthographic default: '+cid)
  need(abx.get('xMustUseDifferentPair') and abx.get('xMustExcludeBothReferenceWordTexts'),'missing X exclusions: '+cid)
  for p in c['pairs']:
   pid=p['id']; ws=p['words']; pa=p['abx']; target=pa.get('targetTokenIndex')
   need(pid not in oldpairs and pid not in seenpairs,'pair ID collision: '+pid); seenpairs.add(pid)
   need(re.fullmatch(r'en-[a-z0-9-]+',pid),'invalid pair ID: '+pid)
   need(p.get('kind')=='minimal','nonminimal candidate: '+pid)
   need(p.get('validation',{}).get('audio')=='pending-listening-review','unsupported audio approval: '+pid)
   need(len(ws)==2,'pair size: '+pid)
   if len(ws)!=2: continue
   need(pa.get('categoryByWordIndex')==[0,1],'category orientation: '+pid)
   need(pa.get('targetPosition')==position,'target position: '+pid)
   need(pa.get('trialGroup')==group,'trial group: '+pid)
   expectedtarget=0 if position=='initial' else len(ws[0]['phonemes'])-1 if position=='final' else 1
   need(target==expectedtarget,'target token index: '+pid)
   difference=[i for i,(a,b) in enumerate(zip(ws[0]['phonemes'],ws[1]['phonemes'])) if a!=b]
   need(len(ws[0]['phonemes'])==len(ws[1]['phonemes']) and difference==[target],'one-phoneme substitution: '+pid)
   need(stress(ws[0]['ipa'])==stress(ws[1]['ipa']),'stress mismatch: '+pid)
   for category,w in enumerate(ws):
    word=textkey(w['text']); allwords.append(word); wordlocales[word]=locale; fact=facts.get(w['text'])
    need(word not in oldwords,'existing English training word: '+word)
    need(exposure_ipa(w['ipa']) not in oldipas,'existing English training IPA: '+word)
    need(word not in reservedtext,'reserved text: '+word)
    need(exposure_ipa(w['ipa']) not in reservedipa,'reserved IPA: '+word)
    need(w['phonemes']==tokens(w['ipa']),'tokenization: '+word)
    need(isinstance(target,int) and 0<=target<len(w['phonemes']) and w['phonemes'][target]==phonemes[category],'category phoneme: '+word)
    need(bool(w.get('meaning')),'missing meaning: '+word)
    need(fact is not None,'missing dictionary evidence: '+word)
    if fact:
     need(ipa(w['ipa'])==fact['editorialBroadIpa'],'editorial evidence mismatch: '+word)
     need(ipa(w['ipa']) in [ipa(x) for x in fact['retrievedIpa']],'dictionary normalization mismatch: '+word)
     need(fact.get('selectedLocale')==locale,'dictionary locale mismatch: '+word)
     need(fact['referenceUrl'] in p['sources'] and fact['referenceUrl'] in c['sources'],'missing word source: '+word)
     need(fact.get('sourceStatus')=='pronunciation-and-selected-sense-read','unread dictionary entry: '+word)
   refs={textkey(w['text']) for w in ws}; choices=[]
   for category in (0,1):
    eligible=[q for q in c['pairs'] if q['id']!=pid and q['abx']['trialGroup']==pa['trialGroup'] and textkey(q['words'][category]['text']) not in refs]
    need(len({textkey(q['words'][category]['text']) for q in eligible})>=2,'insufficient different X words: '+pid)
    # Final targets have pair-specific indices: breathe index 3; seethe/teethe index 2.
    for q in eligible:
     w=q['words'][category]; qt=q['abx'].get('targetTokenIndex')
     need(q['abx'].get('targetPosition')==position and isinstance(qt,int) and 0<=qt<len(w['phonemes']) and w['phonemes'][qt]==phonemes[category],'X category/position mismatch: '+pid)
    combinations+=len(eligible);choices.append([q['words'][category]['text'] for q in eligible])
   checks.append(dict(pairId=pid,targetPosition=position,targetTokenIndex=target,differingTokenIndices=difference,xChoicesByCategory=choices,requiredLocale=locale))
 need(seenids==set(EXPECTED),'contrast inventory mismatch')
 need(len(set(allwords))==len(allwords),'duplicate batch word')
 need(set(facts)==set(allwords) and len(facts)==len(sources['words']),'dictionary inventory mismatch')
 need(audio.get('locale') is None and audio.get('requiredProfilesByLocale')=={'en-US':2,'en-GB':2},'audio profile locale partition')
 need(audio.get('approvedClips')==0 and audio.get('status')=='request-only-no-generation-authorized','invented audio approval')
 need(audio.get('uniqueWords')==len(set(allwords)) and audio.get('requiredCompleteCollectionClips')==2*len(set(allwords)),'incorrect audio counts')
 requests=audio['words']
 need(len(requests)==len(allwords) and {textkey(w['text']) for w in requests}==set(allwords),'audio inventory mismatch')
 for w in requests:
  bindings=[(c,p) for c in candidate['contrasts'] for p in c['pairs'] if p['id']==w['pairId']]
  if len(bindings)!=1: need(False,'audio pair binding: '+w['text']); continue
  c,p=bindings[0]; match=p['words'][w['category']] if w['category'] in (0,1) else {}
  need(w['contrastId']==c['id'] and w['text']==match.get('text') and w['ipa']==match.get('ipa'),'audio category binding: '+w['text'])
  need(w.get('locale')==wordlocales.get(textkey(w['text'])),'audio locale mismatch: '+w['text'])
 actualcounts={loc:sum(v==loc for v in wordlocales.values()) for loc in ['en-US','en-GB']}
 need({x['locale']:x['uniqueWords'] for x in audio['collections']}==actualcounts,'audio collection inventory')
 need(all(x['completeProfiles']==2 and x['requiredClips']==2*x['uniqueWords'] for x in audio['collections']),'audio collection counts')
 routeids=set()
 for r in selection['routes']:
  cid=r['contrastId'];routeids.add(cid);c=next((x for x in candidate['contrasts'] if x['id']==cid),None)
  need(c is not None,'route missing contrast: '+cid)
  if c: need(r['legacyDeclaredPhonemes']==c['phonemes'] and r['requiredAudioLocale']==c['requiredAudioLocale'],'legacy phoneme/locale mismatch: '+cid)
  current=next((x for x in inventory['routes'] if x['legacyPath']==r['legacyPath']),{})
  need(current.get('status')=='missing-contrast','legacy route no longer missing: '+r['legacyPath'])
  need('path:"'+r['legacyPath']+'",element:e.jsx('+r['legacyComponent']+',' in bundle,'legacy component binding: '+cid)
  need('slug:"'+r['legacyPath']+'",title:"'+r['legacyDeclaredTitle']+'",phonemeA:"'+r['legacyDeclaredPhonemes'][0]+'",phonemeB:"'+r['legacyDeclaredPhonemes'][1]+'"' in bundle,'legacy declaration mismatch: '+cid)
 need(routeids==seenids,'route inventory mismatch')
 return dict(passed=not errors,errors=errors,contrasts=len(candidate['contrasts']),pairs=len(checks),uniqueWords=len(set(allwords)),
  eligibleReferencePairXWordCategoryCombinations=combinations,requiredCompleteCollectionClips=2*len(set(allwords)),pairChecks=checks)

def inputs():
 return [read(HERE/x) for x in ('candidates.json','source-audit.json','audio-request.json','selection-evidence.json')]+[
  read(ROOT/'rescue/content/curriculum.json'),read(ROOT/'rescue/content/transfer-candidates.json'),
  {'contrasts':sum([read(ROOT/f'rescue/content/english-legacy-batch{n}/candidates.json')['contrasts'] for n in [2,3,4]],[])},
  read(ROOT/'rescue/content/legacy-coverage.json'),(ROOT/'rescue/discovery/legacy-bundle.js').read_text()]

def run():
 original=inputs(); result=audit(*original)
 def mutation(name,change,expected):
  values=copy.deepcopy(original);change(values);errors=audit(*values)['errors']; rejected=any(expected in e for e in errors)
  if not rejected:result['errors'].append('mutation escaped: '+name)
  return dict(name=name,rejected=rejected,expectedError=expected)
 result['mutationChecks']=[
  mutation('category reversal',lambda d:d[0]['contrasts'][0]['pairs'][0]['words'].reverse(),'category phoneme'),
  mutation('second altered phoneme',lambda d:d[0]['contrasts'][0]['pairs'][1]['words'][1]['phonemes'].__setitem__(2,'t'),'one-phoneme substitution'),
  mutation('split diphthong',lambda d:d[0]['contrasts'][0]['pairs'][0]['words'][0].__setitem__('phonemes',['ð','e','ɪ']),'tokenization'),
  mutation('wrong index copied from longer final word',lambda d:d[0]['contrasts'][1]['pairs'][1]['abx'].__setitem__('targetTokenIndex',3),'X category/position mismatch'),
  mutation('word-final category mislabeled initial',lambda d:d[0]['contrasts'][1]['pairs'][0]['abx'].__setitem__('targetPosition','initial'),'target position'),
  mutation('isolated X group',lambda d:d[0]['contrasts'][0]['pairs'][0]['abx'].__setitem__('trialGroup','isolated'),'insufficient different X words'),
  mutation('reserved French spelling',lambda d:d[0]['contrasts'][0]['pairs'][0]['words'][0].__setitem__('text','puce'),'reserved text'),
  mutation('reserved English homophone',lambda d:d[0]['contrasts'][0]['pairs'][0]['words'][0].update(text='beed',ipa='/bid/',phonemes=['b','i','d']),'reserved IPA'),
  mutation('prior English spelling',lambda d:d[0]['contrasts'][0]['pairs'][0]['words'][0].__setitem__('text','rut'),'existing English training word'),
  mutation('dictionary IPA changed',lambda d:d[1]['words'][0].__setitem__('retrievedIpa',['deɪ']),'dictionary normalization mismatch'),
  mutation('stress missing from berry',lambda d:d[0]['contrasts'][2]['pairs'][0]['words'][1].__setitem__('ipa','/bɛɹi/'),'stress mismatch'),
  mutation('British length mark dropped',lambda d:d[0]['contrasts'][3]['pairs'][0]['words'][0].update(ipa='/pɔt/',phonemes=['p','ɔ','t']),'category phoneme'),
  mutation('American rhotic port substituted',lambda d:d[0]['contrasts'][3]['pairs'][0]['words'][0].update(ipa='/pɔɹt/',phonemes=['p','ɔ','ɹ','t']),'one-phoneme substitution'),
  mutation('British pool labeled US',lambda d:d[0]['contrasts'][3].__setitem__('requiredAudioLocale','en-US'),'contrast locale mismatch'),
  mutation('British profile gate removed',lambda d:d[0]['contrasts'][3].__setitem__('integrationStatus','isolated-awaiting-audio-review-and-integration'),'integration gate'),
  mutation('cross-dialect trial profiles',lambda d:d[0]['contrasts'][3]['abx'].__setitem__('profilesMustShareLocale','any'),'cross-dialect profiles'),
  mutation('British audio request labeled US',lambda d:d[2]['words'][-1].__setitem__('locale','en-US'),'audio locale mismatch'),
  mutation('missing requested word',lambda d:d[2]['words'].pop(),'audio inventory mismatch'),
  mutation('audio category swapped',lambda d:d[2]['words'][0].__setitem__('category',1),'audio category binding'),
  mutation('invented approved recording',lambda d:d[2].__setitem__('approvedClips',1),'invented audio approval'),
  mutation('wrong legacy vowel',lambda d:d[3]['routes'][3].__setitem__('legacyDeclaredPhonemes',['ɔ','ɑ']),'legacy phoneme/locale mismatch'),
 ]
 result['baselineHashesMatch']={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==expected for p,expected in original[3]['inputSha256'].items()}
 if not all(result['baselineHashesMatch'].values()): result['errors'].append('baseline changed; renewed source/inventory review required')
 result.update(passed=not result['errors'],date='2026-09-28',inputSha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [HERE/x for x in ['candidates.json','source-audit.json','audio-request.json','selection-evidence.json']]},
  limitation='Offline integrity and exposure checks only. Selected sources were manually read separately. British routing is not implemented; no audio, profile or learner outcome is approved.')
 (HERE/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:v for k,v in result.items() if k not in ['pairChecks','inputSha256']},ensure_ascii=False,indent=2))
 return 0 if result['passed'] else 1

if __name__=='__main__': sys.exit(run())
