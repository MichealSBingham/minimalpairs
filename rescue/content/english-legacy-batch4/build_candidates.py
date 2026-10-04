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
WORDS = [('pen', 'pɛn', 'a tool for writing in ink', 'pen in American English 2; noun, sense 2'),
 ('pun', 'pʌn', 'a joke based on word meanings or sounds', 'pun in American English; noun'),
 ('ten', 'tɛn', 'the number 10', 'ten in American English; numeral'),
 ('ton', 'tʌn', 'a unit of weight', 'ton in American English 1; weight, not the fashion borrowing'),
 ('hem', 'hɛm', 'a sewn edge of fabric', 'hem in American English 1; noun, sense 1'),
 ('hum', 'hʌm', 'make a low continuous sound', 'hum in American English 1; verb, not the interjection /həm/'),
 ('kin', 'kɪn', 'relatives', 'kin in American English; noun, sense 1'),
 ('king', 'kɪŋ', 'a male monarch', 'king in American English; common noun, sense 1'),
 ('pin', 'pɪn', 'a small pointed fastener', 'pin in American English; noun, sense 2'),
 ('ping', 'pɪŋ', 'a brief high-pitched sound', 'ping in American English; noun, sense 1a'),
 ('win', 'wɪn', 'succeed in a contest', 'win in American English; intransitive verb, sense 1'),
 ('wing', 'wɪŋ', 'a limb used for flight', 'wing in American English; noun, sense 1a'),
 ('tip', 'tɪp', 'the end of something narrow', 'tip in American English 1; noun, sense 1'),
 ('dip', 'dɪp', 'put briefly into liquid', 'dip in American English; transitive verb, sense 1'),
 ('tie', 'taɪ', 'fasten with a knot', 'tie in American English; transitive verb, sense 1'),
 ('die', 'daɪ', 'one numbered cube used in games', 'die in American English 2; noun, sense 1'),
 ('town', 'taʊn', 'a community larger than a village', 'town in American English; noun, sense 2'),
 ('down', 'daʊn', 'toward a lower place', 'down in American English 1; adverb, sense 1'),
 ('rut', 'rʌt', 'a wheel track in the ground', 'rut in American English 1; noun, sense 1'),
 ('rot', 'rɑt', 'decay', 'rot in American English; intransitive verb, sense 1'),
 ('hut', 'hʌt', 'a small simple dwelling', 'hut in American English; noun, sense 1'),
 ('hot', 'hɑt', 'having a high temperature', 'hot in American English; adjective, sense 1a'),
 ('nut', 'nʌt', 'an edible kernel in a hard shell', 'nut in American English; common noun, sense 1'),
 ('not',
  'nɑt',
  'a word expressing negation',
  'not in American English; adverb, not the combining form /noʊt/')]

TOPICS = [('en-dress-strut',
  'e-vs-uh',
  'a2',
  ['ɛ', 'ʌ'],
  'Pen or pun?',
  [('pen', 'pun'), ('ten', 'ton'), ('hem', 'hum')],
  'Focus on the middle vowel, /ɛ/ as in pen or /ʌ/ as in pun. The surrounding consonants stay the same '
  'within each pair.',
  'Use stressed American citation vowels. Ton is the weight unit /tʌn/; hum is the verb /hʌm/, not the '
  'interjection /həm/. Keep the selected /ɛ/ category in pen, ten and hem; these vowels precede nasals.'),
 ('en-n-ng',
  'n-vs-ng',
  'N2',
  ['n', 'ŋ'],
  'Kin or king?',
  [('kin', 'king'), ('pin', 'ping'), ('win', 'wing')],
  'Listen to the last consonant: /n/ as in kin or /ŋ/ as in king. X has a different beginning but belongs to '
  'one of these ending categories.',
  'All three frames use the dictionary /ɪ/ vowel and a single final nasal. King, ping and wing end in /ŋ/, '
  'with no additional /ɡ/ in the selected variety. Preserve the nasal ending when trimming. Normal '
  'coarticulation does not mean that the whole word must sound identical.'),
 ('en-t-d',
  't-vs-d',
  'V2',
  ['t', 'd'],
  'Tip or dip?',
  [('tip', 'dip'), ('tie', 'die'), ('town', 'down')],
  'Listen to the first consonant, including its release into the vowel. Match the initial /t/ or /d/ '
  'category across different word endings.',
  'Use stressed initial /t/ and /d/, not the medial American tap context. Release timing and aspiration '
  'contribute to the contrast; do not describe it as only a vibration switch or trim the onset away. Die is '
  'a singular game cube in the vocabulary note.'),
 ('en-strut-ah',
  'uh-vs-ah',
  'n4',
  ['ʌ', 'ɑ'],
  'Hut or hot?',
  [('rut', 'rot'), ('hut', 'hot'), ('nut', 'not')],
  'Compare the middle vowels /ʌ/ and /ɑ/ in short American English words. Match the vowel category even when '
  'X begins with another consonant.',
  'This is an explicit American dialect adaptation of the legacy /ʌ–ɑː/ topic, not merely length-mark '
  'removal. Rot, hot and not use American LOT /ɑ/ in a reference variety where LOT and PALM share that '
  'phoneme. These words would not supply British /ɑː/ in many British accents. Use only matched American '
  'profiles, never blend British or non-rhotic reference sets; keep full citation not /nɑt/.')]

def read(path):
 return json.loads((ROOT / path).read_text())

def save(name, value):
 (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def normalized_ipa(ipa):
 return ipa.replace('ː','').replace('ɜr','ɝ').replace('r','ɹ').replace('g','ɡ').replace(' ', '')

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
  position = 'initial' if cid=='en-t-d' else 'final' if cid=='en-n-ng' else 'medial'
  target = 0 if position=='initial' else 2 if position=='final' else 1
  group = {'initial':'initial-singleton-v1','final':'final-nasal-cvc-v1','medial':'medial-vowel-cvc-v1'}[position]
  pairs = []
  for a,b in pairwords:
   pairs.append(dict(id='en-'+a+'-'+b, words=[wordmap[a],wordmap[b]], kind='minimal',
    sources=[url(a),url(b)], validation=dict(text='editor-curated',audio='pending-listening-review'),
    abx=dict(categoryByWordIndex=[0,1],targetTokenIndex=target,targetPosition=position,trialGroup=group)))
  focus = {'initial':'Listen to the first consonant in each word.','final':'Listen to the last consonant in each word.','medial':'Listen to the vowel in the middle of each word.'}[position]
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
  retrieval='All 24 selected American IPA and sense entries manually read through the web tool on this date. Other publishers and homographs on the same page are not interchangeable evidence.',
  normalization='Webster /r/ becomes /ɹ/. Preserve the dictionary vowels and diphthongs. No dictionary vowel category is changed. The legacy /ʌ–ɑː/ topic is explicitly adapted to the American /ʌ–ɑ/ contrast using LOT words; this involves dialect-specific lexical incidence, not merely notation compression. The original non-rhotic cup–carp example is not reused.',
  licensing='Factual word/pronunciation checking and original short meaning labels. No dictionary paragraphs, chart artwork or dictionary audio copied or licensed for redistribution.',
  words=evidence,phoneticsSources=[dict(url=VOT_URL,support='Institutional account of stop release/voice-onset timing and the original experiment; no acoustic threshold is imported.'),
   dict(url=ASPIRATION_URL,support='Author textbook explains aspiration in stressed English stop onsets; not evidence for this product’s learning efficacy.'),
   dict(url=IPA_URL,support='Official symbols and optional affricate tie-bar notation. No chart or audio reused.')],
  exclusions=[dict(candidate='ran–rang',reason='Primary Webster entries /ræn/ and /ræŋ/ were read; a defensible broad pair, but not selected because three /ɪ/-vowel frames keep this starter pool more consistent. No claim that ran–rang is invalid.'),
   dict(candidate='sin–sing / thin–thing',reason='Sin and thin already occur in current training; avoid reuse for this batch.'),
   dict(candidate='reserved bin/bean/bid/bead/lick/leak',reason='Reserved transfer words and same-variety homophones remain excluded.')],
  unsupportedClaims=['No pronunciation or voice identity approval','No exact-waveform equivalence','No demonstrated ABX advantage or unseen-word transfer','No route demand or revenue ranking']))
 paths=['rescue/content/legacy-coverage.json','rescue/content/curriculum.json','rescue/content/transfer-candidates.json','rescue/content/english-legacy-batch2/candidates.json','rescue/content/english-legacy-batch3/candidates.json','rescue/discovery/legacy-bundle.js']
 selected={m['legacyPath'] for m in mappings}
 # Explicit prior-batch routes, verified against its saved source evidence by the validator.
 prior={'/english/short-u-vs-long-oo','/english/ae-vs-e','/english/v-vs-w','/english/voiceless-th-vs-f','/english/s-vs-z','/english/f-vs-v','/english/p-vs-b','/english/k-vs-g','/english/sh-vs-s','/english/sh-vs-ch'}
 remaining=[r['legacyPath'] for r in inventory['routes'] if r['language']=='en' and r['status']=='missing-contrast' and r['legacyPath'] not in selected|prior]
 remaining_bindings=[]
 for path in remaining:
  card=re.search(r'slug:"'+re.escape(path)+r'",title:"([^"]+)",phonemeA:"([^"]+)",phonemeB:"([^"]+)"',bundle)
  route=re.search(r'path:"'+re.escape(path)+r'",element:e.jsx\(([^,]+),',bundle)
  assert card and route
  remaining_bindings.append(dict(legacyPath=path,legacyDeclaredTitle=card[1],legacyDeclaredPhonemes=[card[2],card[3]],legacyComponent=route[1],
   status='not-audited-in-this-batch',
   nextAction='Decide and label the target dialect explicitly; do not silently replace /ɒ/ with /ɑ/ or assume every US voice preserves a low-back contrast.' if path.endswith('/aw-vs-o') else 'Source-audit three useful strict pairs, intended lexical senses and compatible target positions. No claim of impossibility is made.'))
 save('selection-evidence.json',dict(date=DATE,routes=mappings,
  rationale='Missing legacy topics with three independently verified strict pairs and useful initial/final consonant and vowel coverage. This is editorial selection, not a traffic ranking.',
  baseline=dict(integratedEnglishTopics=6,legacyEnglishTopics=24,previousIsolatedBatchTopics=10,thisIsolatedBatchTopics=4,
   potentialTopicsIfAllIsolatedBatchesIntegrated=20,remainingTopicsAfterAllBatches=remaining),
  remainingLegacyBindings=remaining_bindings,
  exclusionScope='Current curriculum and batches2/3: English spelling and normalized English IPA. Reserved assessments: spellings across all languages and normalized English IPA. French training ton/pin have different scoped pronunciations and do not prohibit the English words.',
  demandEvidence='The dated revenue-operation-2026-09-27 report has English hub evidence and three already-restored measured topics. No specific observed GSC count is assigned to these four.',
  inputSha256={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths},
  hashPolicy='These hashes identify the selection baseline; the validator also checks exclusions against the current files. Later main-file changes require fresh review, not a silent coverage claim.'))
 audio=[]
 for c in contrasts:
  for p in c['pairs']:
   for index,w in enumerate(p['words']):
    audio.append(dict(languageId='en',locale='en-US',text=w['text'],ipa=w['ipa'],meaning=w['meaning'],contrastId=c['id'],
     pairId=p['id'],category=index,sourceUrl=url(w['text']),status='not-generated-or-approved-by-this-batch',recordingNote=c['dialectNote']))
 save('audio-request.json',dict(date=DATE,status='request-only-no-generation-authorized',languageId='en',locale='en-US',
  requiredProfiles=2,uniqueWords=24,requiredCompleteCollectionClips=48,approvedClips=0,
  instructions=['Produce complete coverage for each licensed profile only after separate generation authorization.',
   'Listen to every exact take; dictionary agreement and automatic acoustic checks do not approve pronunciation.',
   'Keep A and B in the same profile, and X in another complete profile when available; X must be a different word in the same contrast/group.',
   'Preserve word onsets in trimming, especially stop releases and affricates. Do not force identical lengths or remove phonetic cues.',
   'Use the intended lowercase lexical senses and selected full American citation vowels. King/ping/wing have a final /ŋ/ without an extra /ɡ/; review both onsets and nasal tails.'],words=audio))

if __name__ == '__main__':
 build()
