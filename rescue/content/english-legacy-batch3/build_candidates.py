#!/usr/bin/env python3
"""Rebuild only this isolated candidate folder from manually verified editorial facts."""
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DATE = '2026-09-28'
SOURCE = 'Webster’s New World College Dictionary, 5th Digital Edition (2025), hosted by Collins'
IPA_URL = 'https://www.internationalphoneticassociation.org/IPAcharts/IPA_charts_TI/IPA_charts_TI.html'
VOT_URL = 'https://www.haskinslaboratories.org/vot'
ASPIRATION_URL = 'https://ecampusontario.pressbooks.pub/essentialsoflinguistics/chapter/3-5-aspirated-stops-in-english/'

# word, selected dictionary IPA, independently written meaning, selected entry/sense.
WORDS = [
 ('sip','sɪp','drink a little at a time','sip in American English; verb'),
 ('zip','zɪp','fasten a zipper','zip in American English; transitive verb, sense 9'),
 ('seal','sil','a marine mammal','seal in American English 2; animal, sense 1'),
 ('zeal','zil','strong enthusiasm','zeal in American English; noun'),
 ('sink','sɪŋk','go below the surface','sink in American English; intransitive verb'),
 ('zinc','zɪŋk','a metallic element','zinc in American English; noun, sense 1'),
 ('fan','fæn','a device that moves air','fan in American English 1; noun, sense 2'),
 ('van','væn','an enclosed road vehicle','van in American English 3; vehicle, senses 1–2'),
 ('fat','fæt','a substance used in cooking','fat in American English; noun, sense 8'),
 ('vat','væt','a large vessel for liquids','vat in American English; lowercase container noun'),
 ('fail','feɪl','not succeed','fail in American English; intransitive verb'),
 ('veil','veɪl','a covering of thin fabric','veil in American English; common noun'),
 ('pea','pi','a small edible seed','pea in American English; noun, sense 2'),
 ('bee','bi','a pollen-gathering insect','bee in American English 1; insect noun'),
 ('peg','pɛɡ','a short pin used for fastening','peg in American English; common noun, sense 1'),
 ('beg','bɛɡ','ask earnestly','beg in American English; common verb'),
 ('peach','pitʃ','a fruit with fuzzy skin','peach in American English 1; fruit noun'),
 ('beach','bitʃ','a sandy or pebbly shore','beach in American English; noun, sense 1'),
 ('coat','koʊt','an outer garment','coat in American English; noun, sense 1'),
 ('goat','ɡoʊt','a horned hoofed animal','goat in American English; animal, sense 1a'),
 ('curl','kɜrl','twist into a coil','curl in American English; transitive verb, sense 1'),
 ('girl','ɡɜrl','a female child','girl in American English; noun, sense 1'),
 ('came','keɪm','past tense of come','came in American English 1; verb'),
 ('game','ɡeɪm','an activity played for amusement','game in American English 1; noun'),
 ('shack','ʃæk','a roughly built small dwelling','shack in American English; noun'),
 ('sack','sæk','a large bag','sack in American English 1; bag, sense 1a'),
 ('shell','ʃɛl','a protective outer casing','shell in American English; common noun, sense 1'),
 ('sell','sɛl','exchange for money','sell in American English; common transitive verb'),
 ('shock','ʃɑk','a sudden emotional jolt','shock in American English 1; noun, sense 3a'),
 ('sock','sɑk','a knitted foot covering','sock in American English 1; noun, sense 3'),
 ('shop','ʃɑp','a small store','shop in American English; noun, sense 1a'),
 ('chop','tʃɑp','cut with sharp blows','chop in American English 1; transitive verb, sense 1'),
 ('shin','ʃɪn','the front of the lower leg','shin in American English 1; body part, sense 1'),
 ('chin','tʃɪn','the lower part of the face','chin in American English; common body-part noun'),
 ('shoe','ʃu','an item of footwear','shoe in American English; noun, sense 1'),
 ('chew','tʃu','break food with the teeth','chew in American English; transitive verb, sense 1'),
]

# ID, legacy slug/component, phoneme order, label, three pairs, explanation, recording caveat.
TOPICS = [
 ('en-s-z','s-vs-z','qN',['s','z'],'Sip or zip?', [('sip','zip'),('seal','zeal'),('sink','zinc')],
  'Listen for the first consonant in each word: /s/ or /z/. The rest of each reference pair stays the same.',
  'Keep /s/ and /z/ distinct in all three lexical frames. Sink and zinc end in /ŋk/; the target is their first consonant.'),
 ('en-f-v','f-vs-v','DN',['f','v'],'Fan or van?', [('fan','van'),('fat','vat'),('fail','veil')],
  'Compare the first consonant in fan and van, then match the first sound of a different word.',
  'Use the ordinary English words: lowercase vat is a container, not a spelled-out tax abbreviation. Fat is a cooking-substance noun. Preserve /f/ versus /v/ in every profile.'),
 ('en-p-b','p-vs-b','F2',['p','b'],'Pea or bee?', [('pea','bee'),('peg','beg'),('peach','beach')],
  'Listen to the beginning of the word, including how the stop releases into the vowel. Pea and bee share the vowel but begin differently.',
  'These are stressed initial stops. English release timing and aspiration contribute to the distinction; do not coach only throat vibration or use fixed millisecond thresholds. Keep the vowel matched within each pair.'),
 ('en-k-g','k-vs-g','u2',['k','ɡ'],'Coat or goat?', [('coat','goat'),('curl','girl'),('came','game')],
  'Focus on the first consonant, /k/ or /ɡ/, across three different word endings.',
  'Use rhotic American curl and girl with matched /ɝl/. Stressed initial /k/ and /ɡ/ differ in release and voice-onset patterns; do not require every /ɡ/ to have voicing throughout its closure.'),
 ('en-sh-s','sh-vs-s','R2',['ʃ','s'],'Shell or sell?', [('shack','sack'),('shell','sell'),('shock','sock')],
  'Listen to the first hissing sound: /ʃ/ as in shell or /s/ as in sell.',
  'Shell is the noun /ʃɛl/, not the contraction she’ll. Shock and sock use the selected American /ɑ/ citation vowel, matched within each profile.'),
 ('en-sh-ch','sh-vs-ch','H2',['ʃ','tʃ'],'Shoe or chew?', [('shop','chop'),('shin','chin'),('shoe','chew')],
  'Compare the continuous start of /ʃ/ with the stop-and-release start of /tʃ/. Match the initial category even when the rest of X is different.',
  'Treat /tʃ/ as one affricate category. Preserve the closure/release cue in chop, chin and chew; do not clip it in trimming. Shin is the body part /ʃɪn/, not the letter-name reading /ʃin/.'),
]
def read(path):
 return json.loads((ROOT / path).read_text())

def save(name, value):
 (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def normalized_ipa(ipa):
 return ipa.replace('ɜr','ɝ').replace('r','ɹ').replace('g','ɡ').replace(' ', '')

def tokens(ipa):
 return re.findall(r'tʃ|dʒ|eɪ|aɪ|oʊ|aʊ|ɔɪ|.', ipa)

def url(word):
 return 'https://www.collinsdictionary.com/us/dictionary/english/' + word

def build():
 inventory = read('rescue/content/legacy-coverage.json')
 bundle = (ROOT / 'rescue/discovery/legacy-bundle.js').read_text()
 evidence = []
 wordmap = {}
 for word, raw, meaning, entry in WORDS:
  ipa = normalized_ipa(raw)
  wordmap[word] = dict(text=word, ipa='/'+ipa+'/', meaning=meaning, phonemes=tokens(ipa))
  evidence.append(dict(word=word, referenceUrl=url(word), selectedEntry=entry, source=SOURCE,
    retrievedUsIpa=[raw], editorialBroadIpa=ipa, checkedAt=DATE,
    sourceStatus='pronunciation-and-selected-sense-read', audioStatus='not-listened'))
 contrasts = []
 mappings = []
 for cid, slug, component, phonemes, label, pairwords, description, caveat in TOPICS:
  path = '/english/' + slug
  card = re.search(r'slug:"'+re.escape(path)+r'",title:"([^"]+)",phonemeA:"([^"]+)",phonemeB:"([^"]+)"', bundle)
  assert card and [normalized_ipa(card[2]), normalized_ipa(card[3])] == phonemes
  assert 'path:"'+path+'",element:e.jsx('+component+',' in bundle
  record = next(r for r in inventory['routes'] if r['legacyPath']==path)
  assert record['status']=='missing-contrast'
  pairs = []
  for a,b in pairwords:
   pairs.append(dict(id='en-'+a+'-'+b, words=[wordmap[a],wordmap[b]], kind='minimal',
    sources=[url(a),url(b)], validation=dict(text='editor-curated',audio='pending-listening-review'),
    abx=dict(categoryByWordIndex=[0,1],targetTokenIndex=0,targetPosition='initial',trialGroup='initial-singleton-v1')))
  focus = 'Listen to the first consonant in each word.'
  contrasts.append(dict(id=cid,label=label,phonemes=phonemes,description=description,l1Notes=[],
   dialectNote='Selected rhotic American dictionary citation forms. '+caveat, pairs=pairs,
   sources=sorted({u for p in pairs for u in p['sources']}),targetSoundFocus=focus,
   abx=dict(matchType='phoneme',targetSoundFocus=focus,prompt='Which reference shares X’s target sound?',
    categoryLabels=phonemes,categoryOrder='words[0] is category 0; words[1] is category 1',
    xMustUseDifferentPair=True,xMustExcludeBothReferenceWordTexts=True,
    presentation='audio-only-until-answer-or-explicit-text-assist')))
  mappings.append(dict(legacyPath=path,contrastId=cid,proposedGuidePath='/learn/'+cid,
   legacyDeclaredTitle=card[1],legacyDeclaredPhonemes=[card[2],card[3]],legacyComponent=component,
   evidence='Saved bundle hub card declaration and exact route-to-component binding; no old examples reused.',
   authoritativeStatusAtSelection=record['status']))
 candidates=dict(date=DATE,status='isolated-text-candidate-audio-unapproved',languageId='en',locale='en-US',
  dialect='Selected rhotic American English dictionary citation forms; recordings unreviewed',contrasts=contrasts)
 save('candidates.json',candidates)
 save('source-audit.json',dict(date=DATE,source=SOURCE,
  retrieval='All 36 selected American IPA and sense entries manually read through the web tool on this date. Other publishers and homographs on the same page are not interchangeable evidence.',
  normalization='Webster /ɜr/ becomes broad rhotic /ɝ/; /r/ becomes /ɹ/; ASCII g becomes IPA ɡ. Retain /i/, /u/, /ɑ/, /ɛ/ and diphthongs. No vowel substitution. Treat tʃ as one phoneme.',
  licensing='Factual word/pronunciation checking and original short meaning labels. No dictionary paragraphs, chart artwork or dictionary audio copied or licensed for redistribution.',
  words=evidence,phoneticsSources=[dict(url=VOT_URL,support='Institutional account of stop release/voice-onset timing and the original experiment; no acoustic threshold is imported.'),
   dict(url=ASPIRATION_URL,support='Author textbook explains aspiration in stressed English stop onsets; not evidence for this product’s learning efficacy.'),
   dict(url=IPA_URL,support='Official symbols and optional affricate tie-bar notation. No chart or audio reused.')],
  exclusions=[dict(candidate='pin–bin',reason='Bin /bɪn/ is reserved for transfer assessment. Rejected before dictionary research; no impossibility claim.'),
   dict(candidate='ship–chip / ship–sip',reason='Ship is already training material; this batch uses new lexical frames instead.'),
   dict(candidate='shin letter-name reading /ʃin/',reason='Different lexical entry; selected body-part reading is /ʃɪn/.')],
  unsupportedClaims=['No pronunciation or voice identity approval','No exact-waveform equivalence','No demonstrated ABX advantage or unseen-word transfer','No route demand or revenue ranking']))
 paths=['rescue/content/legacy-coverage.json','rescue/content/curriculum.json','rescue/content/transfer-candidates.json','rescue/content/english-legacy-batch2/candidates.json','rescue/discovery/legacy-bundle.js']
 selected={m['legacyPath'] for m in mappings}
 # Explicit prior-batch routes, verified against its saved source evidence by the validator.
 prior={'/english/short-u-vs-long-oo','/english/ae-vs-e','/english/v-vs-w','/english/voiceless-th-vs-f'}
 remaining=[r['legacyPath'] for r in inventory['routes'] if r['language']=='en' and r['status']=='missing-contrast' and r['legacyPath'] not in selected|prior]
 save('selection-evidence.json',dict(date=DATE,routes=mappings,
  rationale='Missing legacy topics with three independently verified strict pairs and useful initial-consonant coverage. This is editorial selection, not a traffic ranking.',
  baseline=dict(integratedEnglishTopics=6,legacyEnglishTopics=24,previousIsolatedBatchTopics=4,thisIsolatedBatchTopics=6,
   potentialTopicsIfBothIsolatedBatchesIntegrated=16,remainingTopicsAfterBothBatches=remaining),
  demandEvidence='The dated revenue-operation-2026-09-27 report has English hub evidence and three already-restored measured topics. No specific observed GSC count is assigned to these six.',
  inputSha256={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths},
  hashPolicy='These hashes identify the selection baseline; the validator also checks exclusions against the current files. Later main-file changes require fresh review, not a silent coverage claim.'))
 audio=[]
 for c in contrasts:
  for p in c['pairs']:
   for index,w in enumerate(p['words']):
    audio.append(dict(languageId='en',locale='en-US',text=w['text'],ipa=w['ipa'],meaning=w['meaning'],contrastId=c['id'],
     pairId=p['id'],category=index,sourceUrl=url(w['text']),status='not-generated-or-approved-by-this-batch',recordingNote=c['dialectNote']))
 save('audio-request.json',dict(date=DATE,status='request-only-no-generation-authorized',languageId='en',locale='en-US',
  requiredProfiles=2,uniqueWords=36,requiredCompleteCollectionClips=72,approvedClips=0,
  instructions=['Produce complete coverage for each licensed profile only after separate generation authorization.',
   'Listen to every exact take; dictionary agreement and automatic acoustic checks do not approve pronunciation.',
   'Keep A and B in the same profile, and X in another complete profile when available; X must be a different word in the same contrast/group.',
   'Preserve word onsets in trimming, especially stop releases and affricates. Do not force identical lengths or remove phonetic cues.',
   'Use ordinary lowercase lexical readings, matched rhotic curl/girl, and the selected American LOT vowel in shock/sock and shop/chop.'],words=audio))

if __name__ == '__main__':
 build()
