#!/usr/bin/env python3
"""Rebuild only this isolated folder from manually checked dictionary facts."""
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DATE = '2026-09-28'
US_SOURCE = 'Webster’s New World College Dictionary, 5th Digital Edition (2025), hosted by Collins'
GB_SOURCE = 'Collins English Dictionary, selected British English entry'

# Word, exact selected source IPA, original meaning, exact entry/sense, locale.
WORDS = [
 ('they','ðeɪ','people or things already mentioned','they in American English; pronoun, sense 1','en-US'),
 ('day','deɪ','a period of 24 hours','day in American English; noun, sense 2a','en-US'),
 ('then','ðɛn','at that time','then in American English; adverb, sense 1','en-US'),
 ('den','dɛn','an animal’s shelter','den in American English; noun, sense 1','en-US'),
 ('though','ðoʊ','although','though in American English; conjunction, sense 1','en-US'),
 ('dough','doʊ','a flour mixture prepared for baking','dough in American English; noun, sense 1','en-US'),
 ('breathe','brið','take air in and out','breathe in American English; intransitive verb, sense 1a','en-US'),
 ('breeze','briz','a gentle wind','breeze in American English 1; noun, sense 1','en-US'),
 ('seethe','sið','be intensely agitated','seethe in American English; intransitive verb, sense 4','en-US'),
 ('seize','siz','grab suddenly','seize in American English; transitive verb, sense 4','en-US'),
 ('teethe','tið','develop the first teeth','teethe in American English; intransitive verb','en-US'),
 ('tease','tiz','provoke with jokes or mocking','tease in American English; transitive verb, sense 3','en-US'),
 ('very','ˈvɛri','to a great extent','very in American English; adverb, sense 6','en-US'),
 ('berry','ˈbɛri','a small fleshy fruit','berry in American English; common noun, sense 1','en-US'),
 ('vote','voʊt','a choice expressed in a group decision','vote in American English; noun, sense 1b','en-US'),
 ('boat','boʊt','a small craft for travelling on water','boat in American English; noun, sense 1','en-US'),
 ('volt','voʊlt','a unit of electrical potential difference','volt in American English 2; electrical unit, not the riding movement','en-US'),
 ('bolt','boʊlt','a threaded metal fastener','bolt in American English 1; noun, sense 5','en-US'),
 ('port','pɔːt','a place where ships load and unload','port in British English 1; noun, sense 1','en-GB'),
 ('pot','pɒt','a deep container used for cooking','pot in British English 1; noun, sense 1','en-GB'),
 ('court','kɔːt','an area marked for a ball game','court in British English; noun, sense 9a','en-GB'),
 ('cot','kɒt','a young child’s bed with sides','cot in British English 1; noun, sense 1','en-GB'),
 ('short','ʃɔːt','small in length','short in British English; adjective, sense 1','en-GB'),
 ('shot','ʃɒt','a photograph','shot in British English 1; noun, sense 10a','en-GB'),
]

TOPICS = [
 dict(id='en-dh-d',slug='voiced-th-vs-d',component='jN',phonemes=['ð','d'],label='They or day?',locale='en-US',position='initial',group='initial-singleton-v1',
  pairs=[('they','day'),('then','den'),('though','dough')],
  description='Match the first consonant: /ð/ as in they or /d/ as in day. X has a different ending but shares one initial sound category.',
  caveat='Use the full American dictionary citation forms, including /ðeɪ/, /ðɛn/ and /ðoʊ/. Do not substitute reduced connected-speech function words or a profile that replaces initial /ð/ with /d/. The distinction is not a voiced-versus-voiceless contrast.'),
 dict(id='en-dh-z',slug='voiced-th-vs-z',component='PN',phonemes=['ð','z'],label='Breathe or breeze?',locale='en-US',position='final',group='final-fricative-after-i-v1',
  pairs=[('breathe','breeze'),('seethe','seize'),('teethe','tease')],
  description='Listen to the last consonant, /ð/ or /z/. All examples have /i/ just before that ending. X can begin differently and still share the same final category.',
  caveat='Preserve the final /ð/ versus /z/ in the American citation forms. Breathe is the verb /bɹið/, not breath /bɹɛθ/; teethe is the verb /tið/, not teeth /tiθ/. Seethe and teethe may need optional meaning help, but are ordinary modern verbs, not invented or obsolete padding. Do not trim away the final fricative.'),
 dict(id='en-v-b',slug='v-vs-b',component='c4',phonemes=['v','b'],label='Vote or boat?',locale='en-US',position='initial',group='initial-singleton-v1',
  pairs=[('very','berry'),('vote','boat'),('volt','bolt')],
  description='Match the first consonant, /v/ or /b/, across different word endings. Very and berry share the same stress pattern and the same remaining sounds.',
  caveat='Use matching American /ˈvɛɹi–ˈbɛɹi/, /voʊt–boʊt/ and /voʊlt–boʊlt/ forms. Very/berry have two syllables while the other pairs have one; all targets remain initial single consonants. Volt means the electrical unit. Do not replace /v/ with /b/ or remove either onset while trimming.'),
 dict(id='en-thought-lot-gb',slug='aw-vs-o',component='E2',phonemes=['ɔː','ɒ'],label='Port or pot? (British)',locale='en-GB',position='medial',group='nonrhotic-gb-medial-vowel-before-t-v1',
  pairs=[('port','pot'),('court','cot'),('short','shot')],
  description='In the selected non-rhotic British forms, compare /ɔː/ with /ɒ/ before final /t/. X uses a different first consonant while retaining one of these vowel categories.',
  caveat='This pool restores the exact legacy /ɔː–ɒ/ declaration using Collins’s non-rhotic British forms. It requires two complete matched en-GB profiles with no pronounced /r/ in port, court or short. It is not an American cot–caught lesson: rhotic US versions add /ɹ/, and substituting /ɑ/ for /ɒ/ changes the target. British accents also vary; the broad dictionary categories specify this selected reference, not every British speaker. Do not infer correctness from locale alone or coach duration as the sole cue.'),
]

def read(path): return json.loads((ROOT/path).read_text())
def save(name,value): (HERE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def normalized_ipa(ipa): return ipa.replace('r','ɹ').replace('g','ɡ').replace(' ','')
def tokens(ipa): return re.findall(r'tʃ|dʒ|eɪ|aɪ|oʊ|aʊ|ɔɪ|[a-zɑɒɔɛɪʊʌəɜɝɹŋʃʒθð]ː|.',ipa.replace('ˈ','').replace('ˌ',''))
def url(word): return 'https://www.collinsdictionary.com/us/dictionary/english/'+word

def build():
 inventory=read('rescue/content/legacy-coverage.json')
 bundle=(ROOT/'rescue/discovery/legacy-bundle.js').read_text()
 evidence=[]; wordmap={}; contrasts=[]; mappings=[]; audio=[]
 for word,raw,meaning,entry,locale in WORDS:
  ipa=normalized_ipa(raw)
  wordmap[word]=dict(text=word,ipa='/'+ipa+'/',meaning=meaning,phonemes=tokens(ipa))
  evidence.append(dict(word=word,referenceUrl=url(word),selectedEntry=entry,source=US_SOURCE if locale=='en-US' else GB_SOURCE,
   selectedLocale=locale,retrievedIpa=[raw],editorialBroadIpa=ipa,checkedAt=DATE,
   sourceStatus='pronunciation-and-selected-sense-read',audioStatus='not-listened'))
 for t in TOPICS:
  path='/english/'+t['slug']; locale=t['locale']; gb=locale=='en-GB'
  card=re.search(r'slug:"'+re.escape(path)+r'",title:"([^"]+)",phonemeA:"([^"]+)",phonemeB:"([^"]+)"',bundle)
  assert card and [card[2],card[3]]==t['phonemes']
  assert 'path:"'+path+'",element:e.jsx('+t['component']+',' in bundle
  record=next(r for r in inventory['routes'] if r['legacyPath']==path)
  assert record['status']=='missing-contrast'
  pairs=[]
  for a,b in t['pairs']:
   target=0 if t['position']=='initial' else len(wordmap[a]['phonemes'])-1 if t['position']=='final' else 1
   pairs.append(dict(id='en-'+a+'-'+b,words=[wordmap[a],wordmap[b]],kind='minimal',sources=[url(a),url(b)],
    validation=dict(text='editor-curated',audio='pending-listening-review'),
    abx=dict(categoryByWordIndex=[0,1],targetTokenIndex=target,targetPosition=t['position'],trialGroup=t['group'])))
  focus={'initial':'Listen to the first consonant in each word.','final':'Listen to the last consonant in each word.','medial':'Listen to the vowel before the final /t/ in each word.'}[t['position']]
  contrasts.append(dict(id=t['id'],label=t['label'],phonemes=t['phonemes'],description=t['description'],l1Notes=[],
   requiredAudioLocale=locale,dialectNote=t['caveat'],
   integrationStatus='blocked-per-contrast-dialect-profile-support-and-audio-review' if gb else 'isolated-awaiting-audio-review-and-integration',
   pairs=pairs,sources=sorted({u for p in pairs for u in p['sources']}),targetSoundFocus=focus,
   abx=dict(matchType='phoneme',targetSoundFocus=focus,prompt='Which reference shares X’s target sound?',categoryLabels=t['phonemes'],
    categoryOrder='words[0] is category 0; words[1] is category 1',xMustUseDifferentPair=True,xMustExcludeBothReferenceWordTexts=True,
    profilesMustShareLocale=locale,presentation='audio-only-until-answer-or-explicit-text-assist')))
  mappings.append(dict(legacyPath=path,contrastId=t['id'],proposedGuidePath='/learn/'+t['id'],legacyDeclaredTitle=card[1],
   legacyDeclaredPhonemes=[card[2],card[3]],legacyComponent=t['component'],requiredAudioLocale=locale,
   evidence='Saved bundle hub category declaration and exact route-to-component binding; old pair lists not reused.',authoritativeStatusAtSelection=record['status']))
  for p in pairs:
   for i,w in enumerate(p['words']):
    audio.append(dict(languageId='en',locale=locale,text=w['text'],ipa=w['ipa'],meaning=w['meaning'],contrastId=t['id'],pairId=p['id'],category=i,
     sourceUrl=url(w['text']),status='not-generated-or-approved-by-this-batch',recordingNote=t['caveat']))
 save('candidates.json',dict(date=DATE,status='isolated-text-candidate-audio-unapproved',languageId='en',locale=None,requiredLocales=['en-US','en-GB'],
  dialect='Three American consonant pools plus a separately gated non-rhotic British vowel pool; never one mixed voice set.',contrasts=contrasts))
 save('source-audit.json',dict(date=DATE,sources=[US_SOURCE,GB_SOURCE],
  retrieval='All 24 selected pronunciation and intended-sense blocks manually read on this date: 18 Webster American entries and six Collins British entries. Mixed-page COBUILD summaries and other publishers are not substituted for those blocks.',
  normalization='Dictionary /r/ becomes /ɹ/ in American forms. Stress marks stay in displayed IPA and are excluded only from phoneme token lists; paired stress patterns are checked. Preserve British /ɔː/ as one vowel token, including its length mark, and preserve /ɒ/. No vowel category or lexical dialect is silently replaced.',
  licensing='Short original meaning labels and factual IPA/source checking only. No dictionary paragraphs, audio, chart artwork or redistribution license copied.',
  words=evidence,
  exclusions=[dict(candidate='there–dare / those–doze',reason='Valid-looking alternatives are unnecessary: three selected pairs per pool have direct source evidence. These alternatives are not claimed independently audited.'),
   dict(candidate='American port–pot / court–cot / short–shot',reason='Not adopted: selected rhotic American forms would differ in /ɹ/ as well as vowel. An en-US audio fallback cannot restore this British pool.'),
   dict(candidate='reserved English and French transfer words',reason='All-language reserved spellings and English reserved IPA are excluded, including different spellings with a reserved English pronunciation.')],
  unsupportedClaims=['No pronunciation or speaker-profile approval','No proof that every British accent preserves the exact selected realization','No product learning-effect or ABX superiority claim','No traffic ranking or revenue increase','No current 24-topic English availability']))
 prior=set()
 for n in [2,3,4]:
  earlier=read(f'rescue/content/english-legacy-batch{n}/selection-evidence.json')
  prior|={r['legacyPath'] for r in earlier.get('routes',earlier.get('selectedLegacyRoutes',[]))}
 selected={m['legacyPath'] for m in mappings}
 remaining=[r['legacyPath'] for r in inventory['routes'] if r['language']=='en' and r['status']=='missing-contrast' and r['legacyPath'] not in prior|selected]
 paths=['rescue/content/legacy-coverage.json','rescue/content/curriculum.json','rescue/content/transfer-candidates.json',
  *[f'rescue/content/english-legacy-batch{n}/candidates.json' for n in [2,3,4]],'rescue/discovery/legacy-bundle.js']
 save('selection-evidence.json',dict(date=DATE,routes=mappings,
  rationale='The four exact legacy topics left after earlier isolated batches, selected without inventing a demand ranking.',
  baseline=dict(integratedEnglishTopics=6,legacyEnglishTopics=24,previousIsolatedBatchTopics=14,thisIsolatedBatchTopics=4,
   topicsWithTextCandidatesIncludingIntegrated=24,topicsPotentiallyCompatibleWithAmericanReferenceAfterAllAudioReview=23,
   britishTopicsBlockedOnSeparateProfileRouting=1,remainingTopicsWithoutTextCandidates=remaining),
  exclusionScope='Current/batches2–4: English spelling and normalized English IPA only. Reserved: spellings across all languages plus English IPA. Ordinary French training spellings do not ban independent English lexemes.',
  integrationGate='No integration in this task. The current English language target is en-US and current audio selection is keyed by languageId with an en-US device fallback, not contrast dialect. British pool requires explicit contrast-level en-GB profile routing and no cross-dialect fallback before release.',
  demandEvidence='No per-topic observed GSC count is claimed for these four.',
  inputSha256={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths},
  hashPolicy='Selection baseline only; validator also rechecks current inventories. Changed inputs require renewed review.'))
 save('audio-request.json',dict(date=DATE,status='request-only-no-generation-authorized',languageId='en',locale=None,
  requiredProfilesByLocale={'en-US':2,'en-GB':2},uniqueWords=24,requiredCompleteCollectionClips=48,approvedClips=0,
  collections=[dict(locale='en-US',uniqueWords=18,completeProfiles=2,requiredClips=36),dict(locale='en-GB',uniqueWords=6,completeProfiles=2,requiredClips=12)],
  instructions=['This inventory grants no synthesis or spend authorization.',
   'Use two complete profiles for each locale separately; A/B share one profile and X uses the other profile of the SAME locale. Never mix a British and American voice in a trial.',
   'Listen to every exact take for pronunciation, selected sense, intact onset/ending and consistent accent; source checks do not approve recordings.',
   'Keep voiced dental and sibilant endings distinct. Breathe/teethe are verbs; very/berry retain matching initial stress. Volt is the electrical unit.',
   'British pool requires selected non-rhotic /ɔː–ɒ/ forms, with no /r/ in port/court/short. Locale labels alone are insufficient. Current en-US device fallback is not acceptable for this pool.'],words=audio))

if __name__=='__main__': build()
