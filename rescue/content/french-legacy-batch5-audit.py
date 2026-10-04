"""Isolated editorial batch: four remaining French topics, no live writes.

Default validates saved evidence. --refresh-sources refreshes only the listed
ATILF entries; externally checked Collins facts stay explicitly recorded.
"""
import argparse
import hashlib
import html
import json
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent.parent
PREFIX = 'french-legacy-batch5'
DATE = '2026-09-28'
PHONETICS = 'https://www.cambridge.org/core/services/aop-cambridge-core/content/view/E2BC8B1DD975FE4B272B088B8345B933/S0025100300004874a.pdf/french.pdf'
CAEN = 'https://moodle.luniversitenumerique.fr/mod/book/view.php?chapterid=2800&id=19413&lang=en'
ROBERT = 'https://grandrobert.lerobert.com/AideGR/Pages/Phonetique.html'

# tokens, independently authored gloss, dictionary headword, part of speech,
# selected TLFi entry. None selects an explicitly checked Collins entry.
WORDS = {
    'dé': ('d e', 'a die; singular of dice', 'dé', 'nom', 0),
    'daim': ('d ɛ̃', 'fallow deer', 'daim', 'nom', 0),
    'fée': ('f e', 'fairy', 'fée', 'nom', 0),
    'faim': ('f ɛ̃', 'hunger', 'faim', 'nom', 0),
    'thé': ('t e', 'tea', 'thé', 'nom', 0),
    'teint': ('t ɛ̃', 'complexion', None, None, None),
    'rat': ('ʁ a', 'rat', 'rat', 'nom', 0),
    'ré': ('ʁ e', 'the musical note D', 'ré', 'nom', 0),
    'la': ('l a', 'the musical note A', 'la', 'nom', 0),
    'lé': ('l e', 'a full-width strip of fabric or wallpaper', 'lé', 'nom', 0),
    'ça': ('s a', 'that; informal demonstrative pronoun', 'ça', 'pronom', 0),
    'ces': ('s e', 'these or those; plural determiner', None, None, None),
    'balle': ('b a l', 'ball; small spherical object used in games', 'balle', 'nom', 0),
    'belle': ('b ɛ l', 'beautiful; feminine singular', 'beau', 'adjectif', 0),
    'salle': ('s a l', 'room; hall', 'salle', 'nom', 0),
    'sel': ('s ɛ l', 'salt', 'sel', 'nom', 0),
    'masse': ('m a s', 'mass; quantity of matter', 'masse', 'nom', 0),
    'messe': ('m ɛ s', 'Mass; Catholic liturgical service', 'messe', 'nom', 0),
    'jeûne': ('ʒ ø n', 'a fast; abstention from food', 'jeûne', 'nom', 0),
    'jeune': ('ʒ œ n', 'young', 'jeune', 'adjectif', 0),
    'veule': ('v ø l', 'weak-willed; literary adjective', 'veule', 'adjectif', 0),
    'veulent': ('v œ l', 'want; present-tense form with they', None, None, None),
    'foehn': ('f ø n', 'warm dry wind descending into Alpine valleys', 'foehn', 'nom', 0),
    'fun': ('f œ n', 'fun; enjoyable, informal adjective', None, None, None),
}

COLLINS = {
    'teint': dict(ipa='tɛ̃', selection='Main noun entry, complexion; not a feminine participle. TLFi legacy typography renders [tẽ], so the selected /ɛ̃/ has separate explicit modern dictionary support.'),
    'ces': dict(ipa='se', selection='Lowercase determiner entry [se]; not ce [sə] or capitalized acronym CES [seəɛs].'),
    'veulent': dict(ipa='vœl', selection='Inflected verb entry linked to vouloir. Third-person plural present is also explicit in TLFi vouloir and University of Caen phonetics.'),
    'fun': dict(ipa='fœn', selection='French informal invariable adjective. This is an established borrowing pronounced with French /œ/, not an English /ʌ/ request.'),
}

SPECS = [
    dict(id='fr-e-in', legacy='/french/e-vs-in', component='W1',
         legacyLabel='é vs in (/e/ vs /ɛ̃/)', label='Fée or faim?', phonemes=['e', 'ɛ̃'],
         pairs=[('dé', 'daim'), ('fée', 'faim'), ('thé', 'teint')],
         position='final', trialGroup='monosyllabic-final-vowel',
         description='Compare oral close-mid /e/ with nasal /ɛ̃/. Listen to the whole vowel category: the difference is not just adding an n sound, and this is not the /ɛ–ɛ̃/ contrast.',
         focus='Listen to the final vowel. X uses a different initial consonant; match its vowel category to A or B.',
         dialect='Northern reference Metropolitan French isolated forms. The nasal category is written broadly /ɛ̃/; actual quality varies by speaker. No final /m/, /n/ or /t/ is added. Keep oral /e/ distinct from /ɛ/.',
         notes=[dict(nativeLanguage='en', note='Do not replace the nasal vowel with a vowel plus English n or ng.'), dict(nativeLanguage='es', note='The target is an oral-versus-nasal vowel contrast, not final written consonant recognition.')]),
    dict(id='fr-a-e', legacy='/french/a-vs-e', component='J1',
         legacyLabel='a vs é (/a/ vs /e/)', label='Rat or ré?', phonemes=['a', 'e'],
         pairs=[('rat', 'ré'), ('la', 'lé'), ('ça', 'ces')],
         position='final', trialGroup='monosyllabic-final-vowel',
         description='Compare the open vowel /a/ with close-mid /e/ at the end of the word. The three frames keep their initial consonant unchanged within each pair.',
         focus='Listen to the final vowel. The initial consonant changes in X; match the vowel rather than spelling, meaning or the whole word.',
         dialect='Northern reference Metropolitan French, explicitly selecting the dictionary /a/ variants for rat and the musical noun la. Their /ɑ/ variants are not silently relabelled. Ré and la name musical notes; lé is a less-frequent textile or wallpaper noun. Ces is the isolated lowercase determiner /se/, without liaison and not the acronym CES.',
         notes=[dict(nativeLanguage='en', note='The /e/ target is one French vowel; avoid treating an English-style off-glide as required.'), dict(nativeLanguage='es', note='These sound categories may feel familiar; still use the recording rather than written letters to answer.')]),
    dict(id='fr-a-eh', legacy='/french/a-vs-e-ouvert', component='l5',
         legacyLabel='a vs è (/a/ vs /ɛ/)', label='Balle or belle?', phonemes=['a', 'ɛ'],
         pairs=[('balle', 'belle'), ('salle', 'sel'), ('masse', 'messe')],
         position='medial', trialGroup='monosyllabic-cvc-vowel',
         description='Listen to the vowel between the consonants: open /a/ or open-mid /ɛ/. This lesson keeps /ɛ/ separate from close-mid /e/.',
         focus='Listen to the middle vowel. Surrounding consonants can change in X; match the vowel category to the reference.',
         dialect='Northern reference Metropolitan French citation forms with no final schwa. All three frames are one syllable; the final consonant is /l/ or /s/. Belle is the feminine form of beau; the selected ball sense of balle is not the older bale spelling.',
         notes=[dict(nativeLanguage='en', note='French /a/ here is not a requirement to use the English vowel of cat.'), dict(nativeLanguage='es', note='The second category is French open-mid /ɛ/, not a substitution of the /e/ from the other lesson.')]),
    dict(id='fr-eu-closed-open', legacy='/french/eu-open-vs-closed', component='_4',
         legacyLabel='eu closed vs open (/ø/ vs /œ/)', label='Jeûne or jeune?', phonemes=['ø', 'œ'],
         pairs=[('jeûne', 'jeune'), ('veule', 'veulent'), ('foehn', 'fun')],
         position='medial', trialGroup='monosyllabic-cvc-rounded-mid-vowel',
         description='Compare close-mid /ø/ with open-mid /œ/ in the selected French readings. Both are rounded front vowels. This is a small, dialect-sensitive lexical contrast, separate from schwa /ə/.',
         focus='Listen to the middle rounded vowel. Match the vowel category even when X has a different initial or final consonant.',
         dialect='Use speakers who preserve the selected /ø–œ/ distinction. TLFi also lists veule /vœl/, which would merge that pair and must be rejected for this lesson. Jeûne and foehn have long-vowel dictionary transcriptions; broad IPA here does not assert equal duration or a pure-height experiment. Veule is literary; foehn is a specialist wind term; fun is a French borrowing. These are three distinct lexical frames, not three common beginner pairs.',
         notes=[dict(nativeLanguage='en', note='Fun is the French word /fœn/ here, not an English /fʌn/ recording. The two French target vowels are both rounded.'), dict(nativeLanguage='es', note='Do not substitute /e/ or /o/, and do not treat the French schwa /ə/ as one of the two labels.')]),
]

PAIR_NOTES = {
    'fr-rat-re': 'Select the independently documented /ʁa/ reading; /ʁɑ/ is also listed in TLFi and is not this target.',
    'fr-la-le': 'La is the musical noun with selected /la/ reading; /lɑ/ is another dictionary variant. Preserve the accent in lé /le/, not le /lə/.',
    'fr-ca-ces': 'Ça is a pronoun and ces a determiner. Both are pronounced in isolation; do not supply a following noun, liaison /z/, or the uppercase acronym.',
    'fr-jeune-fast-jeune-young': 'Preserve the accent in jeûne (fasting) versus jeune (young). Selected broad forms preserve /ø–œ/; older dictionary quantity is not an independent target here.',
    'fr-veule-veulent': 'Use veule /vøl/. TLFi also permits /vœl/; that variant makes these words homophones and is not accepted for this contrast.',
    'fr-foehn-fun': 'Foehn is an established French wind noun; fun is the French informal adjective. This lexical frame is less familiar and cross-language synthesis is a particular listening-review risk.',
}

def read(path):
    return json.loads(path.read_text())

def write(suffix, data):
    (ROOT / f'{PREFIX}-{suffix}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def normalize(text):
    return unicodedata.normalize('NFC', text).casefold().strip()

def identifier(text):
    return unicodedata.normalize('NFKD', text.replace('œ', 'oe')).encode('ascii', 'ignore').decode('ascii')

def broad(ipa):
    # No vowel-quality or oral/nasal substitutions. Quantity is intentionally not
    # a separate token in this broad curriculum; raw quantity is kept as evidence.
    return unicodedata.normalize('NFC', ipa.replace('ʀ', 'ʁ').replace('ε', 'ɛ').replace('oe', 'œ').replace(':', '').replace('ː', ''))

def reference(text):
    _, _, headword, pos, _ = WORDS[text]
    if headword is None:
        return 'https://www.collinsdictionary.com/dictionary/french-english/' + quote(text)
    return 'https://www.portail-lexical.fr/definition/tlfi/' + quote(headword) + '/' + quote(pos)

def fetch_word(text):
    tokens, gloss, headword, pos, index = WORDS[text]
    editorial = ''.join(tokens.split())
    if headword is None:
        spec = COLLINS[text]
        return dict(text=text, source='Collins French-English Dictionary / HarperCollins',
            retrievedAt=DATE, referenceUrl=reference(text), lookupUrl=reference(text),
            retrievalMethod='Official web page opened and explicit selected entry read; saved fact is not a fresh automated HTTP check.',
            selectedEntry=spec['selection'], retrievedIpa=[spec['ipa']], dictionaryBroadIpaCandidates=[spec['ipa']],
            editorialIpa='/' + editorial + '/', originalMeaning=gloss,
            normalization='No segment or quantity change.', lexicalSenseReviewed=True,
            broadIpaMatchesSelectedEntry=spec['ipa'] == editorial)
    url = 'https://www.portail-lexical.fr/api/word/' + quote(headword) + '/' + quote(pos)
    data = json.load(urlopen(url, timeout=25))
    entries = next(x['content'] for x in data['content'] if x['id'] == 'tlfi')
    clean = re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', entries[index]))).strip()
    start = re.search(r'Prononciation(?: et orthographe)?', clean)
    assert start, (text, 'Missing pronunciation section')
    section = clean[start.end():].split('Étymologie')[0]
    ipa = list(dict.fromkeys(re.findall(r'\[([^\]]+)\]', section)))
    return dict(text=text, source='ATILF / TLFi selected lexical entry', retrievedAt=DATE,
        lookupUrl=url, referenceUrl=reference(text), selectedTlfiEntry=index, entryCount=len(entries),
        entryLabel=clean.split(' substantif')[0].split(' adjectif')[0].split(' pronom')[0][:65],
        retrievedIpa=ipa, dictionaryBroadIpaCandidates=[broad(x) for x in ipa],
        editorialIpa='/' + editorial + '/', originalMeaning=gloss,
        normalization='Historical ʀ → broad ʁ, ε → ɛ, oe → œ; dictionary vowel quantity omitted in broad IPA but preserved above. No /a–ɑ/, /e–ɛ/, /ø–œ/ or oral/nasal merger.',
        lexicalSenseReviewed=True, broadIpaMatchesSelectedEntry=editorial in [broad(x) for x in ipa])

def make_candidates():
    contrasts = []
    for s in SPECS:
        pairs = []
        for first, second in s['pairs']:
            words = [dict(text=t, ipa='/' + ''.join(WORDS[t][0].split()) + '/', meaning=WORDS[t][1], phonemes=WORDS[t][0].split()) for t in [first, second]]
            pair_id = 'fr-' + identifier(first) + '-' + identifier(second)
            if (first, second)==('jeûne','jeune'):
                pair_id='fr-jeune-fast-jeune-young'
            pairs.append(dict(id=pair_id, words=words, kind='minimal',
                sources=[reference(first), reference(second)],
                note=PAIR_NOTES.get(pair_id, 'Minimal for the stated broad citation forms; recorded pronunciation remains unreviewed.'),
                validation=dict(text='source-checked-candidate', audio='pending-listening-review'),
                abx=dict(categoryByWordIndex=[0, 1], targetTokenIndex=1,
                         targetPosition=s['position'], trialGroup=s['trialGroup'])))
        contrasts.append(dict(id=s['id'], label=s['label'], phonemes=s['phonemes'],
            description=s['description'], dialectNote=s['dialect'], l1Notes=s['notes'], pairs=pairs,
            sources=[PHONETICS] + ([CAEN, ROBERT] if s['id']=='fr-eu-closed-open' else []),
            targetSoundFocus=s['focus'],
            abx=dict(matchType='phoneme', targetSoundFocus=s['focus'], prompt='Which reference shares X’s target sound?',
                     categoryLabels=s['phonemes'], categoryOrder='words[0] is category 0; words[1] is category 1',
                     xMustUseDifferentPair=True, xMustExcludeBothReferenceWordTexts=True,
                     presentation='audio-only-unless-explicit-text-assist'),
            restoration=dict(legacyUrl=s['legacy'], legacyComponent=s['component'], exactLegacyLabel=s['legacyLabel'],
                             demandEvidence='Restores a missing promised French topic. Saved French-hub demand does not provide a topic-specific click ranking for this batch.'),
            guide=dict(title='French ' + ' vs '.join('/'+p+'/' for p in s['phonemes']) + ' minimal pairs',
                intro=s['description'], practiceInstruction='Listen to A, B, and a different word X. Choose the reference sharing X’s target vowel. Spelling, IPA and meanings remain hidden unless hints are explicitly enabled.',
                audioStatus='Isolated text-audited candidate. No recording is approved by this artifact; complete dialect-consistent audio profiles and listening review are still required.')))
    return dict(schemaVersion='1.0.0', batchId=PREFIX, createdAt=DATE, status='source-checked-isolated-candidates-not-live',
        releaseReady=False, languageId='fr', locale='fr-FR', dialect='Northern reference Metropolitan French; selected citation forms',
        integration=dict(inLiveCurriculum=False, inDefaultAudioManifest=False, routesPublished=False),
        licensing=dict(text='Pronunciation facts and source identifiers only; independently authored meanings and explanations. No dictionary paragraphs or audio imported.',
                       audio='Separate synthesis/recording rights and actual pronunciation review remain required.'), contrasts=contrasts)

def validate_pair(pair, contrast):
    a, b = [w['phonemes'] for w in pair['words']]
    differences = [i for i,(x,y) in enumerate(zip(a,b)) if x != y]
    assert len(a)==len(b) and differences==[pair['abx']['targetTokenIndex']], pair['id']
    i = differences[0]
    assert [a[i],b[i]]==contrast['phonemes'], 'Category misalignment'
    assert pair['abx']['categoryByWordIndex']==[0,1]
    assert all(w['ipa']=='/'+''.join(w['phonemes'])+'/' for w in pair['words'])
    assert i==len(a)-1 if pair['abx']['targetPosition']=='final' else 0<i<len(a)-1
    assert normalize(pair['words'][0]['text'])!=normalize(pair['words'][1]['text'])

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--refresh-sources', action='store_true')
    args=parser.parse_args()
    protected=[ROOT/'curriculum.json', ROOT/'legacy-coverage.json', ROOT/'transfer-candidates.json', ROOT/'build_curriculum.py',
               ROOT/'french-legacy-batch3-candidates.json', ROOT/'french-legacy-batch4-candidates.json', WORKSPACE/'rescue/app/public/audio/manifest.json']
    before={str(p.relative_to(WORKSPACE)):digest(p) for p in protected}
    if args.refresh_sources:
        with ThreadPoolExecutor(max_workers=3) as pool:
            rows=list(pool.map(fetch_word, WORDS))
        write('source-audit',dict(date=DATE, sourcePolicy='Bounded verification of 24 lexical forms; 20 selected ATILF entries and four explicit Collins entries. Source facts only; no copied entry prose or audio.', words=rows,
            rejectedAlternatives=[dict(pair='tas–thé', reason='The inspected TLFi tas entry gives /tɑ/, not /ta/; excluded rather than silently merging /ɑ/ into /a/.'),
                                  dict(pair='deux–de', reason='The second vowel is schwa /ə/, not the promised /œ/ category.'),
                                  dict(pair='œufs–œuf', reason='A final /f/ also changes, so it is not a one-phoneme minimal pair.'),
                                  dict(pair='veule /vœl/–veulent /vœl/', reason='This permitted variant is homophonous and must not be used as contrasting audio.')]))
    evidence={r['text']:r for r in read(ROOT/f'{PREFIX}-source-audit.json')['words']}
    assert set(evidence)==set(WORDS)
    assert all(r['broadIpaMatchesSelectedEntry'] for r in evidence.values()), 'Editorial IPA not supported by selected entry'
    candidate=make_candidates()
    curriculum=read(ROOT/'curriculum.json')
    live=[c for l in curriculum['languages'] for c in l['contrasts']]
    french=next(l for l in curriculum['languages'] if l['id']=='fr')['contrasts']
    old_batches={n:read(ROOT/f'french-legacy-batch{n}-candidates.json') for n in [3,4]}
    prior=[*live, *(c for b in old_batches.values() for c in b['contrasts'])]
    prior_ids={c['id'] for c in prior}
    prior_pairs={p['id'] for c in prior for p in c['pairs']}
    assert not ({c['id'] for c in candidate['contrasts']} & prior_ids)
    transfer=read(ROOT/'transfer-candidates.json')
    reserved_text={normalize(w['text']) for s in transfer['sets'] for p in s['pairs'] for w in p['words']}
    reserved_fr_ipa={normalize(w['ipa']) for s in transfer['sets'] if s['languageId']=='fr' for p in s['pairs'] for w in p['words']}
    bundle=(WORKSPACE/'rescue/discovery/legacy-bundle.js').read_text()
    legacy=read(ROOT/'legacy-coverage.json')
    missing=[r for r in legacy['routes'] if r.get('language')=='fr' and r['status']=='missing-contrast']
    assert len(missing)==8, 'Coverage baseline changed; inspect before regenerating'
    rows=[]
    for contrast,spec in zip(candidate['contrasts'],SPECS):
        start=re.search(r'function '+re.escape(spec['component'])+r'\(',bundle).start()
        end=re.search(r'function \w+\(',bundle[start+1:]).start()+start+1
        assert spec['legacyLabel'] in bundle[start:end]
        route=next(r for r in missing if r['legacyPath']==spec['legacy'])
        assert route['legacyDeclaredPhonemes']==contrast['phonemes']
        for pair in contrast['pairs']:
            assert pair['id'] not in prior_pairs
            assert re.fullmatch(r'[A-Za-z0-9_-]{1,160}',pair['id'])
            validate_pair(pair,contrast)
            refs={normalize(w['text']) for w in pair['words']}
            assert not refs & reserved_text, 'Reserved transfer text leaked'
            assert not {normalize(w['ipa']) for w in pair['words']} & reserved_fr_ipa, 'Reserved homophone leaked'
            assert all(w['ipa']==evidence[w['text']]['editorialIpa'] for w in pair['words'])
            eligible=[[p['words'][k]['text'] for p in contrast['pairs'] if p['id']!=pair['id'] and p['abx']['trialGroup']==pair['abx']['trialGroup'] and normalize(p['words'][k]['text']) not in refs] for k in [0,1]]
            assert all(len(x)>=2 for x in eligible)
            rows.append(dict(id=pair['id'],strictMinimalForSelectedBroadForms=True,categoryAligned=True,eligibleDifferentXByCategory=eligible))
    # Negative control: a swapped category and an added segment must be rejected.
    import copy
    for mutation in ['swap','extra']:
        bad=copy.deepcopy(candidate['contrasts'][0]['pairs'][0])
        if mutation=='swap': bad['words'].reverse()
        else: bad['words'][1]['phonemes'].append('n')
        try: validate_pair(bad,candidate['contrasts'][0])
        except AssertionError: pass
        else: raise AssertionError('Audit accepted '+mutation)
    snapshot=dict(hashes=before,currentContrasts=len(live),currentPairs=sum(len(c['pairs']) for c in live),frenchContrasts=len(french),frenchPairs=sum(len(c['pairs']) for c in french))
    candidate['baseSnapshot']=snapshot
    write('candidates',candidate)
    # Assemble a restoration index by reference, reusing completed batch3/4 work.
    isolated=[*(c for b in old_batches.values() for c in b['contrasts'] if c['id'] not in {x['id'] for x in live}),*candidate['contrasts']]
    all_pending_pairs=[p for c in isolated for p in c['pairs']]
    assert len({p['id'] for p in all_pending_pairs})==len(all_pending_pairs)
    reused_evidence=[]
    pending_combinations=0
    for contrast in isolated:
        old_batch=next((n for n,b in old_batches.items() if any(c['id']==contrast['id'] for c in b['contrasts'])),None)
        source_file=ROOT/(f'french-legacy-batch{old_batch}-source-audit.json' if old_batch else f'{PREFIX}-source-audit.json')
        source_words={r['text']:r for r in read(source_file)['words']}
        if old_batch:
            reused_evidence.append(dict(contrastId=contrast['id'],sourceAudit=str(source_file.relative_to(WORKSPACE)),sha256=digest(source_file),originalCheckedAt=DATE,retrievalRepeated=False))
        for pair in contrast['pairs']:
            validate_pair(pair,contrast)
            refs={normalize(w['text']) for w in pair['words']}
            assert not refs & reserved_text
            assert not {normalize(w['ipa']) for w in pair['words']} & reserved_fr_ipa
            for word in pair['words']:
                proof=source_words[word['text']]
                assert proof['broadIpaMatchesSelectedEntry'] and word['ipa']==proof['editorialIpa']
            for category in [0,1]:
                eligible={p['words'][category]['text'] for p in contrast['pairs'] if p['id']!=pair['id'] and p['abx']['trialGroup']==pair['abx']['trialGroup'] and normalize(p['words'][category]['text']) not in refs}
                assert len(eligible)>=2
                pending_combinations+=len(eligible)
    coverage=[]
    for route in missing:
        c=next(c for c in isolated if c['restoration']['legacyUrl']==route['legacyPath'])
        file=next((f'french-legacy-batch{n}-candidates.json' for n,b in old_batches.items() if any(x['id']==c['id'] for x in b['contrasts'])),f'{PREFIX}-candidates.json')
        coverage.append(dict(legacyPath=route['legacyPath'],phonemes=route['legacyDeclaredPhonemes'],contrastId=c['id'],candidateFile=file,pairs=len(c['pairs']),status='audited-candidate-not-integrated'))
    assert len(coverage)==8 and sum(r['pairs'] for r in coverage)==24
    write('remaining-coverage',dict(date=DATE,authoritativeInventory='rescue/content/legacy-coverage.json',baseSnapshot=snapshot,
        integratedFrenchTopics=len(french),legacyFrenchTopics=31,missingFromProduct=8,isolatedAuditedTopics=8,
        newBatchTopics=4,reusedAuditedTopics=4,prospectiveFrenchTopics=31,prospectiveFrenchPairs=snapshot['frenchPairs']+24,
        prospectiveTotalContrasts=len(live)+8,prospectiveTotalPairs=snapshot['currentPairs']+24,
        claimLimit='Candidate coverage is not published product coverage, full old-library equivalence, or recording approval.',
        reusedEvidence=reused_evidence,allPendingPairsRevalidated=True,referencePairXCategoryCombinations=pending_combinations,topics=coverage))
    manifest=read(WORKSPACE/'rescue/app/public/audio/manifest.json')
    voices=[v['id'] for v in manifest['voicesByLanguage']['fr']]
    clips={(c['languageId'],c['text'],c['voiceId']):c for c in manifest['clips']}
    training_text={normalize(w['text']) for c in french for p in c['pairs'] for w in p['words']}
    audio=[]
    for text,(tokens,gloss,*_) in WORDS.items():
        existing=[clips[('fr',text,v)] for v in voices if ('fr',text,v) in clips]
        audio.append(dict(languageId='fr',text=text,ipa='/'+''.join(tokens.split())+'/',locale='fr-FR',meaning=gloss,
            alreadyInTraining=normalize(text) in training_text,contrastIds=[c['id'] for c in candidate['contrasts'] if any(w['text']==text for p in c['pairs'] for w in p['words'])],
            existingClips=[dict(voiceId=c['voiceId'],url=c['url'],status=c.get('status')) for c in existing],
            missingVoiceIds=[v for v in voices if ('fr',text,v) not in clips],reviewStatus='unreviewed',
            reviewInstruction='Verify the exact isolated word and selected phonemic category, naturalness and stable voice. Preserve accents. No final schwa or added article/subject. '+('Reject veule /vœl/; category 0 requires /vøl/.' if text=='veule' else '')+(' Use French /fœn/, not English /fʌn/.' if text=='fun' else '')+(' Select /a/, not documented /ɑ/ variant.' if text in ['rat','la'] else '')+(' Use lowercase ces /se/; do not spell the acronym.' if text=='ces' else '')))
    missing_clips=sum(len(w['missingVoiceIds']) for w in audio)
    write('audio-request',dict(date=DATE,status='request-only-no-generation-or-manifest-change',languageId='fr',locale='fr-FR',voiceIds=voices,
        uniqueWords=len(audio),existingCachedClips=sum(len(w['existingClips']) for w in audio),missingCachedClips=missing_clips,
        requirement='At least two complete profiles in the stated variety, then real listening review. Different provider or voice IDs require all words for that new profile; cache presence does not imply reviewed pronunciation.',words=audio))
    remaining_words={}
    for contrast in isolated:
        for pair in contrast['pairs']:
            for word in pair['words']:
                if word['text'] in remaining_words:
                    assert remaining_words[word['text']]['ipa']==word['ipa'], 'Conflicting readings of shared spelling'
                    remaining_words[word['text']]['contrastIds'].append(contrast['id'])
                    continue
                existing=[clips[('fr',word['text'],v)] for v in voices if ('fr',word['text'],v) in clips]
                remaining_words[word['text']]=dict(languageId='fr',text=word['text'],ipa=word['ipa'],meaning=word['meaning'],locale='fr-FR',
                    contrastIds=[contrast['id']],sourceUrls=pair['sources'],dialectNote=contrast['dialectNote'],
                    existingClips=[dict(voiceId=c['voiceId'],url=c['url'],status=c.get('status')) for c in existing],
                    missingVoiceIds=[v for v in voices if ('fr',word['text'],v) not in clips],reviewStatus='unreviewed')
    remaining_audio=list(remaining_words.values())
    write('remaining-audio-request',dict(date=DATE,status='all-eight-missing-topics-request-only',voiceIds=voices,
        uniqueWords=len(remaining_audio),existingCachedClips=sum(len(w['existingClips']) for w in remaining_audio),
        missingCachedClips=sum(len(w['missingVoiceIds']) for w in remaining_audio),
        requirement='This is a fresh cache snapshot for all eight pending topics, superseding old batch cache counts. A different provider/profile needs every listed word. No cache presence is listening approval.',words=remaining_audio))
    assert all(digest(p)==before[str(p.relative_to(WORKSPACE))] for p in protected), 'Protected file changed during audit'
    write('validation',dict(date=DATE,status='passed-text-and-cross-word-eligibility-only',baseSnapshot=snapshot,totalPairs=len(rows),sourceCheckedUniqueWords=len(evidence),
        pairs=rows,referencePairXCategoryCombinations=48,allEightPendingTopicsRevalidated=True,
        allPendingPairs=len(all_pending_pairs),allPendingReferencePairXCategoryCombinations=pending_combinations,
        negativeControls=['swapped categories rejected','extra phoneme rejected'],
        transferTextOverlap=[],sameLanguageTransferIpaOverlap=[],protectedFilesUnchanged=True,
        audioReadiness=dict(missingCachedClips=missing_clips,listeningApproval=False),
        limits=['Broad phonemic facts are not an acoustic validation.','Dialect-sensitive selected variants must be enforced by listening, not inferred from a voice locale.','No measured retention, transfer or revenue improvement is asserted.']))
    print(json.dumps(dict(newContrasts=4,newPairs=12,words=len(audio),reusedContrasts=4,totalMissingTopicsWithCandidates=8,
        missingCachedClips=missing_clips,protectedFilesUnchanged=True)))

if __name__=='__main__':
    main()
