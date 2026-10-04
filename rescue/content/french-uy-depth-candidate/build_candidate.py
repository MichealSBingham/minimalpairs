#!/usr/bin/env python3
"""Build only the isolated depth candidate; source facts were manually read."""
import hashlib
import json
import unicodedata
from pathlib import Path
from urllib.parse import quote

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
DATE='2026-09-30'
WORDS=[
 # text, authored IPA, original meaning, primary raw IPA, part of speech, selected TLFi sense
 ('dessous','dəsu','underneath','d(ə)su','adverbe','DESSOUS1, II.A, autonomous adverb'),
 ('dessus','dəsy','on top','ḓ(ə)sy','adverbe','DESSUS1, II.A.1, adverb'),
 ('égout','eɡu','a sewer','egu','nom','ÉGOUT, B.1.b, usual underground drainage channel'),
 ('aigu','eɡy','sharp or pointed','egy','adjectif','AIGU, I.A.1, pointed or sharp object'),
 ('écrou','ekʁu','a nut used with a screw or bolt','ekʀu','nom','ÉCROU1, A, mechanical fastener; not the prison record'),
 ('écru','ekʁy','unbleached, describing cloth','ekʀy','adjectif','ÉCRU, B.1, usual textile sense; not the obsolete general sense'),
 ('bouche','buʃ','a mouth','buʃ','nom','BOUCHE, ordinary human mouth'),
 ('bûche','byʃ','a log for a fire','byʃ','nom','BÛCHE1, A, piece of firewood'),
 ('joute','ʒut','a contest or verbal sparring match','ʒut','nom','JOUTE, B, extended competition/rivalry sense; not only medieval jousting'),
 ('jute','ʒyt','jute fibre used in sacks and rope','ʒyt','nom','JUTE, metonymic textile-fibre sense'),
 ('bouleau','bulo','a birch tree','bulo','nom','BOULEAU, A, tree; not the homophone boulot'),
 ('bulot','bylo','a whelk shellfish','bylo','nom','Larousse French-English, masculine noun, whelk'),
]
SET_SPECS=[
 dict(id='fr-u-y-depth-final-v1',label='New words: the final vowel',position='final',group='fr-uy-depth-final-v1',
  pairs=[('dessous','dessus'),('égout','aigu'),('écrou','écru')],
  focus='Listen to the last vowel, at the very end of each word.',
  note='The target is the final /u/ or /y/, not the first vowel. Use the selected two-syllable forms: preserve schwa in both dessous and dessus, initial /e/ in both égout and aigu, and matching /ekʁ/ in écrou and écru.'),
 dict(id='fr-u-y-depth-medial-v1',label='New words: the first vowel',position='medial',group='fr-uy-depth-first-vowel-v1',
  pairs=[('bouche','bûche'),('joute','jute'),('bouleau','bulot')],
  focus='Listen to the first vowel, just after the first consonant.',
  note='The target /u/ or /y/ always follows the initial consonant and precedes another consonant. Bouche/bûche and joute/jute are one syllable; bouleau/bulot are two. In the latter pair, the second vowel remains /o/. Do not instruct learners to match the last vowel in this set.'),
]

def source(text,pos):
 if text=='bulot':return 'https://www.larousse.fr/dictionnaires/francais-anglais/bulot/1004826'
 return 'https://www.portail-lexical.fr/definition/tlfi/'+quote(text)+'/'+pos
def collins(text):return 'https://www.collinsdictionary.com/dictionary/french-english/'+quote(text)
def identifier(s):return ''.join(c for c in unicodedata.normalize('NFD',s) if not unicodedata.combining(c))
def save(name,value):(HERE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def read(path):return json.loads((ROOT/path).read_text())
def training_paths():
 p=ROOT/'rescue/content'
 return sorted({p/'curriculum.json',p/'english_legacy_batch1.json',*p.glob('french*candidates.json'),*p.glob('english-legacy-batch*/candidates.json')})
def dictionary_normalize(s):return s.replace('ʀ','ʁ').replace('g','ɡ').replace('ḓ','d').replace('(ə)','ə')

def build():
 words={};facts=[]
 for text,ipa,meaning,raw,pos,sense in WORDS:
  urls=[source(text,pos)]
  if text in ['dessous','dessus','égout','aigu','bouleau']:urls.append(collins(text))
  if text=='bulot':urls.append('https://www.larousse.fr/dictionnaires/college/bulot/5767')
  words[text]=dict(text=text,ipa='/'+ipa+'/',phonemes=list(ipa),meaning=meaning,lexicalForm='dictionary-headword')
  variants=[];note='No segment change except historical TLFi /ʀ/→broad /ʁ/ and /g/→/ɡ/ where present.'
  if text in ['dessous','dessus']:
   variants=[ipa.replace('ə','')]
   note='TLFi and Collins explicitly mark schwa optional. This candidate selects the schwa-present form in BOTH words; its absence in only one take is not an accepted pair realization. Historical dental /ḓ/ is rendered broad /d/ in dessus; Collins independently gives /d(ə)sy/.'
  if text=='aigu':
   variants=['ɛɡy'];note='TLFi also records an initial /ɛ/ variant. Select /eɡy/, independently corroborated by current Collins; /ɛɡy/ with /eɡu/ would introduce a second vowel difference.'
  if text=='bûche':
   note='TLFi gives /byʃ/ and separately notes historical half-length in Passy 1914. The candidate selects the explicit broad citation form; the circumflex is not an instruction to manufacture a duration contrast. Natural realization still requires listening review.'
  facts.append(dict(word=text,referenceUrls=urls,selectedSource='Larousse French-English Dictionary' if text=='bulot' else 'ATILF / TLFi lexical portal',
   lookupUrl=None if text=='bulot' else 'https://www.portail-lexical.fr/api/word/'+quote(text)+'/'+pos,
   selectedEntry=sense,selectedTlfiEntry=None if text=='bulot' else 0,rawSelectedIpa=raw,editorialIpa=ipa,
   otherDocumentedForms=variants,normalization=note,meaning=meaning,checkedAt=DATE,
   sourceStatus='primary-pronunciation-and-intended-sense-read',audioStatus='not-generated-or-reviewed',
   dictionaryForm='independent-headword-not-added-inflection'))
 sets=[]
 for spec in SET_SPECS:
  pairs=[]
  for a,b in spec['pairs']:
   target=len(words[a]['phonemes'])-1 if spec['position']=='final' else 1
   sources=sorted({u for f in facts if f['word'] in [a,b] for u in f['referenceUrls']})
   pairs.append(dict(id='fr-depth-'+identifier(a)+'-'+identifier(b),words=[words[a],words[b]],kind='minimal',sources=sources,
    validation=dict(text='primary-source-checked-candidate',audio='pending-listening-review'),
    abx=dict(categoryByWordIndex=[0,1],targetTokenIndex=target,targetPosition=spec['position'],trialGroup=spec['group'])))
  sets.append(dict(id=spec['id'],baseContrastId='fr-u-y',label=spec['label'],phonemes=['u','y'],requiredAudioLocale='fr-FR',
   targetSoundFocus=spec['focus'],description=spec['note'],pairs=pairs,
   sources=sorted({u for p in pairs for u in p['sources']}),
   abx=dict(matchType='phoneme',prompt='Which reference shares X’s target sound?',targetSoundFocus=spec['focus'],
    categoryLabels=['u','y'],xMustUseDifferentPair=True,xMustExcludeBothReferenceWordTexts=True,
    presentation='audio-only-until-answer-or-explicit-text-assist',profilesMustShareLocale='fr-FR')))
 save('candidates.json',dict(schemaVersion=1,candidateVersion='fr-u-y-depth-v1',preparedAt=DATE,status='isolated-text-candidate-audio-unapproved',
  releaseReady=False,saleReady=False,languageId='fr',locale='fr-FR',baseContrastId='fr-u-y',
  dialect='Northern reference French citation forms; matched optional-schwa realization and selected initial /e/; no extra final schwa.',
  relationship='Six additional independent lexical pairs beyond the four public fr-u-y pairs and all existing English/French candidate training; reserved assessments excluded.',
  defaultSetLength=12,sets=sets,mixedRevisit=dict(pairIds=[p['id'] for s in sets for p in s['pairs']],
   requireSameTrialGroup=True,instructionMustFollowReferenceSet=True,
   implementationStatus='blocked-on-per-reference-set-focus',releaseReady=False,
   warning='A mixed revisit must select X only from the reference set/group and display its corresponding target-focus instruction. Do not flatten all six into an undifferentiated group.'),
  claimLimits=['Additional within-program practice vocabulary, not globally unseen material','No assessment or transfer claim','No audio approval, paid entitlement implementation or sale-readiness','No evidence that six pairs justify recurring payment']))
 save('source-audit.json',dict(preparedAt=DATE,words=facts,
  retrieval='Eleven selected TLFi pronunciation and sense entries read through the official lexical API. Bulot read in two official Larousse entries, each explicitly /bylo/. Collins independently read for dessous/dessus, égout/aigu and bouleau. No dictionary audio acquired.',
  normalization='Preserve all vowel categories. Expand explicitly optional schwa only by choosing its present form consistently; normalize historical uvular /ʀ/ and dental /ḓ/ to broad /ʁ/ and /d/, and /g/ to /ɡ/. No /e–ɛ/ merger.',
  lexicalSuitability='All selected items have independent modern dictionary headword senses. Joute, jute, écru and bulot are less beginner-familiar than the public CV starter; offer short post-answer meanings, not a claim that every item is high-frequency. No plural or conjugated duplicate is counted as added depth.',
  licensing='Pronunciation facts, source URLs and independently written short glosses only; no dictionary entry paragraphs, artwork or recordings copied. Dictionary consultation grants no recording redistribution license.',
  rejectedOrOmitted=[
   dict(pair='boule–bulle; joue–jus; cour–cure; pour–pur',reason='At least one proposed word or French pronunciation is already in current or staged training; excluded from this added-depth milestone.'),
   dict(pair='pouce–puce; moule–mule; rousse–russe',reason='Reserved assessment material; forbidden here, including French homophones under different spellings.'),
   dict(pair='route–rut',reason='Rut is already an English batch4 training spelling; the task expressly excludes all current/candidate English and French spellings.'),
   dict(pair='loup–lu; pou–pu',reason='Not selected: using participles to fill a numerical target conflicts with this depth brief. No claim that such citation-form pairs are linguistically impossible.'),
   dict(pair='boucher–bûcher beside bouche–bûche',reason='Not needed; avoid presenting a closely related suffix extension of the same local frame as another distinct depth milestone.'),
   dict(pair='flou–flux',reason='Not selected or source-audited in this task; six independently checked items are available without relying on a potentially variable final-consonant reading.')],
  boundaries=['No frequency ranking from historical literary counts','No pronunciation or speaker approval','No revenue or learning-effect projection change']))
 paths=training_paths()+[ROOT/'rescue/content/transfer-candidates.json',ROOT/'research/paid-program-implementation-decision-2026-09-28.md']
 main=read('rescue/content/curriculum.json');base=next(c for l in main['languages'] if l['id']=='fr' for c in l['contrasts'] if c['id']=='fr-u-y')
 save('selection-evidence.json',dict(preparedAt=DATE,brief='research/paid-program-implementation-decision-2026-09-28.md',
  publicStarterPairIds=[p['id'] for p in base['pairs']],publicStarterPairs=len(base['pairs']),additionalPairs=6,additionalWords=12,
  trainingSourceFiles=[str(p.relative_to(ROOT)) for p in training_paths()],
  exclusionScope='All current and candidate English/French training spellings; all-language reserved assessment spellings; French current/candidate/reserved IPA, including alternate spellings of an already-used form.',
  inputSha256={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
  hashPolicy='Baseline hashes plus freshly reconstructed exclusions on every validation. Changed files require renewed review; additional candidate files must also enter the inventory.',
  commercialStatus='Candidate content only; not a second deliverable release, reviewed audio, validated demand, recurring value proof or sale-ready program.'))
 requests=[]
 for s in sets:
  for p in s['pairs']:
   for i,w in enumerate(p['words']):requests.append(dict(languageId='fr',locale='fr-FR',setId=s['id'],pairId=p['id'],category=i,text=w['text'],ipa=w['ipa'],meaning=w['meaning'],status='request-only-unapproved'))
 save('audio-request.json',dict(preparedAt=DATE,status='request-only-no-generation-authorized',requiredProfiles=2,uniqueWords=12,requiredCompleteCollectionClips=24,approvedClips=0,
  languageId='fr',locale='fr-FR',words=requests,
  reviewRequirements=['Two complete licensed profiles covering both categories and all 12 words, with exact-take listening review; no synthetic/acoustic shortcut to approval.',
   'Same profile for A/B, another complete profile of the same variety for X; X uses a different lexical pair within the same set/group.',
   'Dessous/dessus retain schwa in both selected takes per profile; neither receives a category-specific added syllable or consonant.',
   'Égout/aigu both begin /eɡ/; reject initial /ɛ/ only in aigu. Écrou/écru share /ekʁ/.',
   'Bouche/bûche and joute/jute end in consonants without an added schwa. Preserve final /ʃ,t/ when trimming.',
   'Bouleau/bulot target the FIRST vowel; keep the second vowel /o/ in both. Do not confuse bulot with boulot.',
   'Glosses specify joute as a contest, jute as textile fibre, écru as unbleached and bulot as a whelk. Approve natural dictionary-matching speech, not exaggerated vowel duration.']))

if __name__=='__main__':build()
