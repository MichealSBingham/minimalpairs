#!/usr/bin/env python3
"""Offline depth/exposure checks; no source retrieval or audio approval is implied."""
import copy
import hashlib
import json
import sys
import unicodedata
from pathlib import Path
from build_candidate import training_paths, dictionary_normalize, SET_SPECS

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
def read(p):return json.loads(p.read_text())
def textkey(s):return unicodedata.normalize('NFC',s).casefold().strip()
def ipakey(s):return unicodedata.normalize('NFC',s).strip('/[] ').replace('ʀ','ʁ').replace('g','ɡ').replace('ː','').replace(':','').replace('ˈ','').replace('ˌ','')
def tokens(s):return list(ipakey(s))
def words(x):
 if isinstance(x,dict):
  if 'text' in x and 'ipa' in x:
   yield x['text'],x['ipa']
   return
  for k,v in x.items():
   if k=='pairs' and isinstance(v,list):
    for pair in v:
     if isinstance(pair,list):
      # Legacy four-field word tuples occur only inside an explicit pairs array.
      # Do not mistake source URLs, phoneme tokens or prose lists for vocabulary.
      for word in pair:
       if not (isinstance(word,list) and len(word)==4 and all(isinstance(s,str) for s in word)):
        raise ValueError('unknown legacy word shape; update exposure extraction explicitly')
       yield word[0],word[1]
     else:yield from words(pair)
   else:yield from words(v)
 elif isinstance(x,list):
  for v in x:yield from words(v)

def exposure():
 trainingtext={}; frenchipa={}; pairids=set()
 def ids(x):
  if isinstance(x,dict):
   if 'words' in x and 'id' in x:pairids.add(x['id'])
   for v in x.values():ids(v)
  elif isinstance(x,list):
   for v in x:ids(v)
 for path in training_paths():
  data=read(path)
  scopes=[(l['id'],l) for l in data['languages'] if l['id'] in ['fr','en']] if path.name=='curriculum.json' else [('fr' if path.name.startswith('french') else 'en',data)]
  for lang,items in scopes:
   ids(items)
   for text,ipa in words(items):
    trainingtext.setdefault(textkey(text),set()).add(str(path.relative_to(ROOT)))
    if lang=='fr':frenchipa.setdefault(ipakey(ipa),set()).add(text)
 reserved=read(ROOT/'rescue/content/transfer-candidates.json')
 return dict(trainingtext=trainingtext,frenchipa=frenchipa,pairids=pairids,
  reservedtext={textkey(t) for t,_ in words(reserved)},reservedipa={ipakey(i) for s in reserved['sets'] if s['languageId']=='fr' for _,i in words(s)})

def audit(candidate,sources,audio,selection,excluded):
 errors=[];checks=[]; combinations=0; allwords=[]; allipas=[]; seenpairs=set()
 def need(ok,message):
  if not ok:errors.append(message)
 need(candidate.get('languageId')=='fr' and candidate.get('locale')=='fr-FR','wrong language/locale')
 need(candidate.get('baseContrastId')=='fr-u-y','wrong base contrast')
 need(candidate.get('status')=='isolated-text-candidate-audio-unapproved' and candidate.get('releaseReady') is False and candidate.get('saleReady') is False,'unsupported readiness claim')
 facts={w['word']:w for w in sources['words']}
 expected={s['id']:s for s in SET_SPECS}; seensets=set()
 need(len(candidate.get('sets',[]))==2,'expected two sets')
 for s in candidate.get('sets',[]):
  sid=s['id'];need(sid not in seensets,'duplicate set');seensets.add(sid);spec=expected.get(sid)
  need(spec is not None,'unknown set: '+sid)
  if not spec:continue
  need(s.get('baseContrastId')=='fr-u-y' and s.get('phonemes')==['u','y'],'set category contract: '+sid)
  need(s.get('requiredAudioLocale')=='fr-FR','set locale: '+sid)
  need(s.get('targetSoundFocus')==spec['focus'],'wrong focus instruction: '+sid)
  need(len(s['pairs'])==3,'set must have three pairs: '+sid)
  a=s.get('abx',{})
  need(a.get('categoryLabels')==['u','y'] and a.get('matchType')=='phoneme','ABX categories: '+sid)
  need(a.get('presentation')=='audio-only-until-answer-or-explicit-text-assist','text exposed by default')
  need(a.get('xMustUseDifferentPair') and a.get('xMustExcludeBothReferenceWordTexts'),'X identity exclusion missing')
  need(a.get('profilesMustShareLocale')=='fr-FR','profile locale mismatch')
  for p in s['pairs']:
   pid=p['id'];ws=p['words'];abx=p['abx'];target=abx.get('targetTokenIndex')
   need(pid not in seenpairs and pid not in excluded['pairids'],'duplicate/existing pair ID: '+pid);seenpairs.add(pid)
   need(p.get('kind')=='minimal','not strict minimal: '+pid)
   need(p.get('validation',{}).get('audio')=='pending-listening-review','unsupported audio approval: '+pid)
   need(len(ws)==2,'invalid pair size: '+pid)
   if len(ws)!=2:continue
   need(abx.get('categoryByWordIndex')==[0,1],'category order: '+pid)
   need(abx.get('targetPosition')==spec['position'] and abx.get('trialGroup')==spec['group'],'position/group mismatch: '+pid)
   expectedtarget=len(ws[0]['phonemes'])-1 if spec['position']=='final' else 1
   need(target==expectedtarget,'target index: '+pid)
   diff=[i for i,(x,y) in enumerate(zip(ws[0]['phonemes'],ws[1]['phonemes'])) if x!=y]
   need(len(ws[0]['phonemes'])==len(ws[1]['phonemes']) and diff==[target],'one-phoneme substitution: '+pid)
   for category,w in enumerate(ws):
    key=textkey(w['text']);ipa=ipakey(w['ipa']);allwords.append(key);allipas.append(ipa);fact=facts.get(w['text'])
    need(key not in excluded['trainingtext'],'existing English/French training spelling: '+key)
    need(ipa not in excluded['frenchipa'],'existing French training pronunciation: '+key)
    need(key not in excluded['reservedtext'],'reserved spelling: '+key)
    need(ipa not in excluded['reservedipa'],'reserved French pronunciation: '+key)
    need(w.get('lexicalForm')=='dictionary-headword','inflection padding: '+key)
    need(w['phonemes']==tokens(w['ipa']),'tokenization: '+key)
    need(isinstance(target,int) and 0<=target<len(w['phonemes']) and w['phonemes'][target]==['u','y'][category],'category phoneme: '+key)
    need(fact is not None,'missing evidence: '+key)
    if fact:
     need(ipa==fact['editorialIpa'] and ipa==dictionary_normalize(fact['rawSelectedIpa']),'dictionary selection mismatch: '+key)
     need(w['meaning']==fact['meaning'] and bool(w['meaning']),'meaning/evidence mismatch: '+key)
     need(fact.get('sourceStatus')=='primary-pronunciation-and-intended-sense-read','unread dictionary fact: '+key)
     need(fact.get('dictionaryForm')=='independent-headword-not-added-inflection','source inflection padding: '+key)
     need(all(u in p['sources'] and u in s['sources'] for u in fact['referenceUrls']),'source references missing: '+key)
     for variant in fact['otherDocumentedForms']:
      need(ipakey(variant) not in excluded['reservedipa'],'reserved French variant: '+key)
   refs={textkey(w['text']) for w in ws}; choices=[]
   for category in [0,1]:
    qs=[q for q in s['pairs'] if q['id']!=pid and q['abx']['trialGroup']==abx['trialGroup'] and textkey(q['words'][category]['text']) not in refs]
    need(len(qs)==2,'two distinct X words required: '+pid)
    for q in qs:
     qt=q['abx'].get('targetTokenIndex');qw=q['words'][category]
     need(q['abx'].get('targetPosition')==spec['position'] and isinstance(qt,int) and 0<=qt<len(qw['phonemes']) and qw['phonemes'][qt]==['u','y'][category],'X category/position: '+pid)
    combinations+=len(qs);choices.append([q['words'][category]['text'] for q in qs])
   checks.append(dict(setId=sid,pairId=pid,targetTokenIndex=target,differingTokenIndices=diff,xChoicesByCategory=choices))
 need(seensets==set(expected),'set inventory mismatch')
 need(len(allwords)==12 and len(set(allwords))==12,'duplicate or missing words')
 need(len(set(allipas))==12,'duplicate sound forms')
 need(set(facts)==set(allwords) and len(facts)==len(sources['words']),'source inventory mismatch')
 mixed=candidate.get('mixedRevisit',{})
 need(mixed.get('requireSameTrialGroup') is True and mixed.get('instructionMustFollowReferenceSet') is True,'mixed revisit loses position/focus')
 need(mixed.get('implementationStatus')=='blocked-on-per-reference-set-focus' and mixed.get('releaseReady') is False,'unsupported mixed-revisit readiness')
 need(set(mixed.get('pairIds',[]))==seenpairs and len(mixed.get('pairIds',[]))==6,'mixed revisit pair inventory')
 need(audio.get('status')=='request-only-no-generation-authorized' and audio.get('approvedClips')==0,'invented audio authorization/approval')
 need(audio.get('uniqueWords')==12 and audio.get('requiredProfiles')==2 and audio.get('requiredCompleteCollectionClips')==24,'audio counts')
 requests=audio['words']
 need(len(requests)==12 and {textkey(w['text']) for w in requests}==set(allwords),'audio inventory mismatch')
 for w in requests:
  rows=[(s,p) for s in candidate['sets'] for p in s['pairs'] if p['id']==w['pairId']]
  if len(rows)!=1:need(False,'audio pair binding: '+w['text']);continue
  s,p=rows[0];match=p['words'][w['category']] if w['category'] in [0,1] else {}
  need(w['setId']==s['id'] and w['text']==match.get('text') and w['ipa']==match.get('ipa') and w['meaning']==match.get('meaning'),'audio category binding: '+w['text'])
  need(w.get('locale')=='fr-FR' and w.get('languageId')=='fr','audio locale: '+w['text'])
 need(selection.get('additionalPairs')==6 and selection.get('additionalWords')==12 and selection.get('publicStarterPairs')==4,'depth inventory claim')
 return dict(passed=not errors,errors=errors,sets=len(seensets),strictPairs=len(checks),uniqueWords=len(set(allwords)),
  eligibleReferencePairXWordCategoryCombinations=combinations,requiredCompleteCollectionClips=24,pairChecks=checks)

def run():
 excluded=exposure();original=[read(HERE/x) for x in ['candidates.json','source-audit.json','audio-request.json','selection-evidence.json']]
 result=audit(*original,excluded)
 extraction_checks={
  'word objects ignore embedded phoneme arrays':list(words({'text':'bouche','ipa':'/buʃ/','phonemes':['b','u','ʃ','ə']}))==[('bouche','/buʃ/')],
  'source and prose lists are not vocabulary':list(words({'sources':['url1','url2','url3','url4'],'notes':['a','b','c','d']}))==[],
  'legacy word tuples are extracted inside pairs':list(words({'pairs':[[['bouche','buʃ','mouth','b u ʃ'],['bûche','byʃ','log','b y ʃ']]]}))==[('bouche','buʃ'),('bûche','byʃ')],
 }
 result['exposureExtractionChecks']=extraction_checks
 if not all(extraction_checks.values()):result['errors'].append('exposure extraction failed')
 def mutation(name,fn,expected):
  values=copy.deepcopy(original);fn(values); errors=audit(*values,excluded)['errors'];rejected=any(expected in e for e in errors)
  if not rejected:result['errors'].append('mutation escaped: '+name)
  return dict(name=name,rejected=rejected,expectedError=expected)
 result['mutationChecks']=[
  mutation('reversed categories',lambda d:d[0]['sets'][0]['pairs'][0]['words'].reverse(),'category phoneme'),
  mutation('aigu initial open vowel',lambda d:d[0]['sets'][0]['pairs'][1]['words'][1].update(ipa='/ɛɡy/',phonemes=list('ɛɡy')),'one-phoneme substitution'),
  mutation('schwa omitted in one category only',lambda d:d[0]['sets'][0]['pairs'][0]['words'][1].update(ipa='/dsy/',phonemes=list('dsy')),'one-phoneme substitution'),
  mutation('added final schwa',lambda d:d[0]['sets'][1]['pairs'][0]['words'][1].update(ipa='/byʃə/',phonemes=list('byʃə')),'one-phoneme substitution'),
  mutation('wrong final target copied from another pair',lambda d:d[0]['sets'][0]['pairs'][1]['abx'].__setitem__('targetTokenIndex',3),'X category/position'),
  mutation('second vowel targeted in bouleau',lambda d:d[0]['sets'][1]['pairs'][2]['abx'].__setitem__('targetTokenIndex',3),'category phoneme'),
  mutation('medial pool given final group',lambda d:d[0]['sets'][1]['pairs'][0]['abx'].__setitem__('trialGroup','fr-uy-depth-final-v1'),'position/group mismatch'),
  mutation('mixed revisit crosses groups',lambda d:d[0]['mixedRevisit'].__setitem__('requireSameTrialGroup',False),'mixed revisit loses position/focus'),
  mutation('mixed revisit fixed wrong instruction',lambda d:d[0]['mixedRevisit'].__setitem__('instructionMustFollowReferenceSet',False),'mixed revisit loses position/focus'),
  mutation('mixed revisit declared ready without UI routing',lambda d:d[0]['mixedRevisit'].__setitem__('releaseReady',True),'unsupported mixed-revisit readiness'),
  mutation('public French training word',lambda d:d[0]['sets'][0]['pairs'][0]['words'][0].__setitem__('text','boule'),'existing English/French training spelling'),
  mutation('English candidate training word',lambda d:d[0]['sets'][0]['pairs'][0]['words'][0].__setitem__('text','rut'),'existing English/French training spelling'),
  mutation('reserved English assessment spelling',lambda d:d[0]['sets'][0]['pairs'][0]['words'][0].__setitem__('text','bead'),'reserved spelling'),
  mutation('reserved French homophone under new spelling',lambda d:d[0]['sets'][0]['pairs'][0]['words'][0].update(text='pousse',ipa='/pus/',phonemes=list('pus')),'reserved French pronunciation'),
  mutation('current French homophone under new spelling',lambda d:d[0]['sets'][0]['pairs'][0]['words'][0].update(text='cours',ipa='/kuʁ/',phonemes=list('kuʁ')),'existing French training pronunciation'),
  mutation('inflection counted as new lexical item',lambda d:d[0]['sets'][0]['pairs'][0]['words'][0].__setitem__('lexicalForm','inflected-duplicate'),'inflection padding'),
  mutation('altered primary source IPA',lambda d:d[1]['words'][0].__setitem__('rawSelectedIpa','d(ə)sy'),'dictionary selection mismatch'),
  mutation('missing request',lambda d:d[2]['words'].pop(),'audio inventory mismatch'),
  mutation('request category swapped',lambda d:d[2]['words'][0].__setitem__('category',1),'audio category binding'),
  mutation('false audio approval',lambda d:d[2].__setitem__('approvedClips',1),'invented audio authorization/approval'),
  mutation('false sale readiness',lambda d:d[0].__setitem__('saleReady',True),'unsupported readiness claim'),
 ]
 result['baselineHashesMatch']={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in original[3]['inputSha256'].items()}
 result['candidateFileInventoryMatches']=original[3]['trainingSourceFiles']==[str(p.relative_to(ROOT)) for p in training_paths()]
 if not all(result['baselineHashesMatch'].values()) or not result['candidateFileInventoryMatches']:result['errors'].append('baseline changed; renewed review required')
 result['exposureInventory']=dict(trainingSources=len(training_paths()),englishFrenchTrainingSpellings=len(excluded['trainingtext']),frenchTrainingPronunciations=len(excluded['frenchipa']),allLanguageReservedSpellings=len(excluded['reservedtext']),frenchReservedPronunciations=len(excluded['reservedipa']))
 result.update(passed=not result['errors'],preparedAt='2026-09-30',inputSha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [HERE/x for x in ['candidates.json','source-audit.json','audio-request.json','selection-evidence.json']]},
  limitation='Offline declared-fact checks only; primary reading is recorded separately. No audio review, learner unseen-material claim, implementation or commercial validation.')
 (HERE/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:v for k,v in result.items() if k not in ['pairChecks','inputSha256']},ensure_ascii=False,indent=2))
 return 0 if result['passed'] else 1

if __name__=='__main__':sys.exit(run())
