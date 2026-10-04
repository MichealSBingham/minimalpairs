"""Build and validate isolated French candidates; never writes live curriculum/audio.

Default: validate saved dictionary evidence. --refresh-sources: perform bounded
ATILF/TLFi editorial lookups, retaining IPA and entry identifiers, not entry prose.
"""
import argparse
import hashlib
import html
import json
import re
import unicodedata
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent.parent
PREFIX = 'french-legacy-batch4'
DATE = '2026-09-28'
PHONETICS = 'https://www.cambridge.org/core/services/aop-cambridge-core/content/view/E2BC8B1DD975FE4B272B088B8345B933/S0025100300004874a.pdf/french.pdf'
WORDS = {
    'bol': ('b ɔ l', 'bowl', 'nom', 1),
    'boule': ('b u l', 'ball; spherical object', 'nom', 0),
    'cor': ('k ɔ ʁ', 'horn; wind instrument', 'nom', 0),
    'cour': ('k u ʁ', 'courtyard', 'nom', 0),
    'sort': ('s ɔ ʁ', 'fate; destiny', 'nom', 0),
    'sourd': ('s u ʁ', 'deaf; masculine singular', 'adjectif', 0),
    'pur': ('p y ʁ', 'pure', 'adjectif', 0),
    'peur': ('p œ ʁ', 'fear', 'nom', 0),
    'bure': ('b y ʁ', 'coarse woollen cloth', 'nom', 0),
    'beurre': ('b œ ʁ', 'butter', 'nom', 0),
    'sur': ('s y ʁ', 'on; upon', 'préposition', 0),
    'sœur': ('s œ ʁ', 'sister', 'nom', 0),
    'lit': ('l i', 'bed', 'nom', 0),
    'lé': ('l e', 'a full-width strip of fabric or wallpaper', 'nom', 0),
    'nid': ('n i', 'nest', 'nom', 0),
    'nez': ('n e', 'nose', 'nom', 0),
    'prix': ('p ʁ i', 'price; prize', 'nom', 0),
    'pré': ('p ʁ e', 'meadow', 'nom', 0),
}
SPECS = [
    dict(id='fr-o-open-u', legacy='/french/o-ouvert-vs-ou', component='A1',
         legacyLabel='o ouvert vs ou (/ɔ/ vs /u/)', label='Bol or boule?', phonemes=['ɔ', 'u'],
         pairs=[('bol', 'boule'), ('cor', 'cour'), ('sort', 'sourd')],
         targetPosition='medial', trialGroup='monosyllabic-cvc-vowel',
         description='Listen to the vowel between the consonants. These pairs contrast open-mid /ɔ/ with close /u/, both rounded vowels. This is separate from the /o–u/ lesson.',
         targetSoundFocus='Listen to the vowel in the middle of each word. The surrounding consonants may change in X; match the vowel, not the whole word.',
         dialectNote='Northern reference Metropolitan French, in isolated one-syllable words without a final schwa. Final /ʁ/ may lengthen the preceding vowel; the broad transcription omits that contextual length in both members. Keep /ɔ/ distinct from /o/ and /u/ distinct from /y/. Sourd uses its masculine form, with no pronounced final d.',
         notes=[dict(nativeLanguage='en', note='Avoid substituting an English vowel-plus-r sequence for the vowel followed by the French rhotic in cor/cour and sort/sourd.'),
                dict(nativeLanguage='es', note='French /ɔ/ here is the open-mid category, distinct from the close-mid /o/ taught in another lesson.')],
         priorityEvidence='A distinct missing legacy vowel contrast with three common, dictionary-supported noun/adjective pairs. Saved account evidence provides French-hub demand, not a click ranking for this topic.'),
    dict(id='fr-y-eu-open', legacy='/french/u-vs-eu-ouvert', component='C1',
         legacyLabel='u vs eu ouvert (/y/ vs /œ/)', label='Pur or peur?', phonemes=['y', 'œ'],
         pairs=[('pur', 'peur'), ('bure', 'beurre'), ('sur', 'sœur')],
         targetPosition='medial', trialGroup='monosyllabic-cvc-vowel-before-r',
         description='Both target vowels are front and rounded: close /y/ versus open-mid /œ/. Listen to the vowel before the final French r. The separate /y–ø/ lesson uses a different mid vowel.',
         targetSoundFocus='Listen to the vowel before the final French r. The opening consonant changes in X; match the vowel category.',
         dialectNote='Northern reference Metropolitan French citation forms. Every pair has a medial target followed by /ʁ/. Contextual vowel length is omitted symmetrically in broad IPA; no /œ–ø/ merger is made. Sur is the fully pronounced isolated preposition, not a reduced conversational form. Bure is a less-frequent cloth word, included as a real lexical item rather than a fabricated form.',
         notes=[dict(nativeLanguage='en', note='French /y/ is one rounded vowel, not the English sequence in you. Compare the complete vowel quality before r.'),
                dict(nativeLanguage='es', note='Both targets require front rounded vowel categories; do not substitute ordinary Spanish /u/ or /e/.')],
         priorityEvidence='Restores the missing open-mid rounded target without redirecting it to the integrated /y–ø/ contrast. Three real pairs share the same consonant-vowel-r frame; no topic-level click rank is available.'),
    dict(id='fr-i-e', legacy='/french/i-vs-e', component='r5',
         legacyLabel='i vs é (/i/ vs /e/)', label='Nid or nez?', phonemes=['i', 'e'],
         pairs=[('lit', 'lé'), ('nid', 'nez'), ('prix', 'pré')],
         targetPosition='final', trialGroup='monosyllabic-final-vowel',
         description='Compare two unrounded front vowels: close /i/ and close-mid /e/. All targets are word-final. Keep /e/ distinct from the open-mid /ɛ/ category.',
         targetSoundFocus='Listen to the vowel at the end of each word. The first consonant or consonant cluster changes in X; match the final vowel.',
         dialectNote='Northern reference Metropolitan French in isolation. Lit, nid, nez and prix have no final spoken t, d, z or x in these forms. Lé is a noun meaning a strip of fabric or wallpaper, not the article le /lə/; retain its written accent in any synthesis request. Prix/pré have a two-consonant onset but the same final-vowel target position.',
         notes=[dict(nativeLanguage='en', note='The /e/ target is a single French vowel; an English-style off-glide is not the goal.'),
                dict(nativeLanguage='es', note='Use the audio to distinguish these final vowel categories before enabling spelling hints.')],
         priorityEvidence='Restores the exact legacy /i–e/ topic using three independent lexical frames. The noun lé is less familiar and explicitly glossed; no topic-level click rank is available.'),
]


def read(path):
    return json.loads(path.read_text())


def write(suffix, value):
    (ROOT / f'{PREFIX}-{suffix}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(text):
    return unicodedata.normalize('NFC', text).casefold().strip()


def identifier(text):
    # Persisted practice pair IDs use ASCII; preserve accents in word text/audio.
    return unicodedata.normalize('NFKD', text.replace('œ', 'oe')).encode('ascii', 'ignore').decode('ascii')


def source_url(text):
    return 'https://www.portail-lexical.fr/definition/tlfi/' + quote(text) + '/' + quote(WORDS[text][2])


def broad(ipa):
    # Never change a to ɑ, o to ɔ, or oral to nasal vowels.
    return unicodedata.normalize('NFC', ipa.replace('ʀ', 'ʁ').replace('ε', 'ɛ').replace('oe', 'œ').replace(':', '').replace('ː', ''))


def refresh_sources():
    rows = []
    for text, (tokens, meaning, pos, index) in WORDS.items():
        url = 'https://www.portail-lexical.fr/api/word/' + quote(text) + '/' + quote(pos)
        try:
            data = json.load(urlopen(url, timeout=25))
        except HTTPError as error:
            if error.code == 429:
                raise SystemExit('Stopped on rate limit. No automatic retry.') from error
            raise
        entries = next(x['content'] for x in data['content'] if x['id'] == 'tlfi')
        clean = re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', entries[index]))).strip()
        start = re.search(r'Prononciation(?: et orthographe)?', clean)
        assert start, (text, 'TLFi pronunciation section missing')
        section = clean[start.end():].split('Étymologie')[0]
        # Store pronunciation facts, not copied definition paragraphs or audio.
        ipa = list(dict.fromkeys(re.findall(r'\[([^\]]+)\]', section)))
        rows.append(dict(text=text, source='ATILF / TLFi selected lexical entry',
            retrievedAt=DATE, lookupUrl=url, referenceUrl=source_url(text),
            selectedTlfiEntry=index, entryCount=len(entries),
            entryLabel=clean.split(' substantif')[0].split(' adjectif')[0].split(' pronom')[0][:60],
            retrievedIpa=ipa, dictionaryBroadIpaCandidates=[broad(x) for x in ipa],
            editorialIpa='/' + ''.join(tokens.split()) + '/', originalMeaning=meaning,
            normalization='Historical TLFi ʀ → broad ʁ, ε → ɛ, oe → œ; contextual vowel length before /ʁ/ omitted symmetrically in both words. No vowel-quality merger.',
            lexicalSenseReviewed=True,
            broadIpaMatchesSelectedEntry=''.join(tokens.split()) in [broad(x) for x in ipa]))
        print(text, rows[-1]['editorialIpa'], rows[-1]['broadIpaMatchesSelectedEntry'], flush=True)
    write('source-audit', dict(date=DATE, sourcePolicy='Bounded editorial verification of 18 lexemes. Only source identifiers and pronunciation facts retained; glosses authored independently. No dictionary audio copied.', words=rows))


def make_candidates():
    contrasts = []
    for spec in SPECS:
        pairs = []
        for first, second in spec['pairs']:
            words = [dict(text=t, ipa='/' + ''.join(WORDS[t][0].split()) + '/',
                          meaning=WORDS[t][1], phonemes=WORDS[t][0].split()) for t in [first, second]]
            pair = dict(id='fr-' + identifier(first) + '-' + identifier(second), words=words, kind='minimal',
                sources=[source_url(first), source_url(second)],
                validation=dict(text='source-checked-candidate', audio='pending-listening-review'),
                abx=dict(categoryByWordIndex=[0, 1], targetTokenIndex=next(i for i, (a, b) in enumerate(zip(words[0]['phonemes'], words[1]['phonemes'])) if a != b),
                         targetPosition=spec['targetPosition'], trialGroup=spec['trialGroup']))
            if first == 'bure':
                pair['note'] = 'Bure is a real but less-frequent noun for coarse woollen cloth; use the first TLFi sense.'
            if second == 'lé':
                pair['note'] = 'Lé names a strip of fabric or wallpaper. Retain the accent: this noun /le/ is distinct from the article le /lə/.'
            pairs.append(pair)
        focus = spec['targetSoundFocus']
        contrasts.append(dict(id=spec['id'], label=spec['label'], phonemes=spec['phonemes'],
            description=spec['description'], l1Notes=spec['notes'], pairs=pairs,
            dialectNote=spec['dialectNote'], sources=[PHONETICS],
            targetSoundFocus=focus,
            abx=dict(matchType='phoneme', targetSoundFocus=focus,
                     prompt='Which reference shares X’s target sound?', categoryLabels=spec['phonemes'],
                     categoryOrder='words[0] is category 0; words[1] is category 1',
                     xMustUseDifferentPair=True, xMustExcludeBothReferenceWordTexts=True,
                     presentation='audio-only-unless-explicit-text-assist'),
            restoration=dict(legacyUrl=spec['legacy'], legacyComponent=spec['component'],
                             exactLegacyLabel=spec['legacyLabel'], demandEvidence=spec['priorityEvidence']),
            guide=dict(title='French ' + ' vs '.join('/' + p + '/' for p in spec['phonemes']) + ' minimal pairs',
                       intro=spec['description'],
                       practiceInstruction='Listen to A, B, and a different word X. Choose the reference sharing X’s target vowel. Word text, spelling, IPA, and meanings stay hidden unless hints are explicitly enabled.',
                       audioStatus='Candidate only. Existing cached clips are generated and unreviewed; new words have no cached clips. No release or listening approval is implied.')))
    return dict(schemaVersion='1.0.0', batchId=PREFIX, createdAt=DATE,
                status='source-checked-isolated-candidates-not-live', releaseReady=False,
                languageId='fr', locale='fr-FR', dialect='Northern reference Metropolitan French; isolated words',
                scope='Three source-supported remaining legacy topics. Current integration covers 21/31; isolated batch3 covers three more candidates. Saved demand does not rank these topics by clicks.',
                integration=dict(inLiveCurriculum=False, inDefaultAudioManifest=False, routesPublished=False),
                licensing=dict(text='Original explanations and glosses. Dictionary links and pronunciation facts provide evidence; no dictionary paragraphs or recordings included.', audio='Separate provider/license and pronunciation review required; this artifact grants no rights to dictionary or research audio.'),
                contrasts=contrasts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh-sources', action='store_true')
    args = parser.parse_args()
    protected = [ROOT / 'curriculum.json', ROOT / 'legacy-coverage.json', ROOT / 'transfer-candidates.json',
                 WORKSPACE / 'rescue/app/public/audio/manifest.json', ROOT / 'french-legacy-batch3-candidates.json']
    before = {str(p.relative_to(WORKSPACE)): digest(p) for p in protected}
    if args.refresh_sources:
        refresh_sources()
    source_audit = read(ROOT / f'{PREFIX}-source-audit.json')
    sources = {r['text']: r for r in source_audit['words']}
    assert set(sources) == set(WORDS)
    assert all(r['broadIpaMatchesSelectedEntry'] for r in sources.values())
    candidate = make_candidates()
    current = read(ROOT / 'curriculum.json')
    legacy = read(ROOT / 'legacy-coverage.json')
    bundle = (WORKSPACE / 'rescue/discovery/legacy-bundle.js').read_text()
    all_current = [c for l in current['languages'] for c in l['contrasts']]
    training_words = {normalize(w['text']) for c in all_current for p in c['pairs'] for w in p['words']}
    batch3 = read(ROOT / 'french-legacy-batch3-candidates.json')['contrasts']
    all_pair_ids = {p['id'] for c in [*all_current, *batch3] for p in c['pairs']}
    # Reserve every text in the transfer artifact, regardless of language.
    def texts(value):
        if isinstance(value, dict):
            return ({normalize(value['text'])} if isinstance(value.get('text'), str) else set()) | set().union(*(texts(v) for v in value.values()))
        if isinstance(value, list):
            return set().union(*(texts(v) for v in value))
        return set()
    transfer = read(ROOT / 'transfer-candidates.json')
    reserved = texts(transfer)
    assert not (set(map(normalize, WORDS)) & reserved), 'Reserved transfer item leaked'
    reserved_french_ipa = {normalize(w['ipa']).strip('/') for pool in transfer['sets']
                          if pool['languageId'] == 'fr' for p in pool['pairs'] for w in p['words']}
    candidate_ipa = {normalize(''.join(spec[0].split())) for spec in WORDS.values()}
    assert not (candidate_ipa & reserved_french_ipa), 'Reserved transfer homophone leaked'
    assert all(c['id'] not in {x['id'] for x in [*all_current, *batch3]} for c in candidate['contrasts'])
    pair_rows, contrast_rows = [], []
    for contrast in candidate['contrasts']:
        spec = next(s for s in SPECS if s['id'] == contrast['id'])
        begin = re.search(r'function ' + re.escape(spec['component']) + r'\(', bundle).start()
        end = re.search(r'function \w+\(', bundle[begin + 1:]).start() + begin + 1
        assert spec['legacyLabel'] in bundle[begin:end]
        legacy_row = next(r for r in legacy['routes'] if r.get('legacyPath') == spec['legacy'])
        assert legacy_row['contrastId'] is None, 'Candidate topic already restored'
        combinations = 0
        for pair in contrast['pairs']:
            assert pair['id'] not in all_pair_ids
            assert re.fullmatch(r'[A-Za-z0-9_-]{1,160}', pair['id']), 'Pair ID must survive practice-history validation'
            a, b = [w['phonemes'] for w in pair['words']]
            different = [i for i, (left, right) in enumerate(zip(a, b)) if left != right]
            assert len(a) == len(b) and different == [pair['abx']['targetTokenIndex']]
            assert [a[different[0]], b[different[0]]] == contrast['phonemes']
            assert (different[0] == len(a) - 1) if spec['targetPosition'] == 'final' else (0 < different[0] < len(a) - 1)
            for word in pair['words']:
                assert word['ipa'] == sources[word['text']]['editorialIpa']
            references = {normalize(w['text']) for w in pair['words']}
            eligible = [[p['words'][category]['text'] for p in contrast['pairs']
                         if p['id'] != pair['id'] and p['abx']['trialGroup'] == pair['abx']['trialGroup']
                         and normalize(p['words'][category]['text']) not in references] for category in (0, 1)]
            assert all(len(items) >= 2 for items in eligible)
            combinations += sum(map(len, eligible))
            pair_rows.append(dict(id=pair['id'], strictMinimal=True, categoryAligned=True,
                                  targetPosition=spec['targetPosition'], eligibleDifferentXByCategory=eligible))
        contrast_rows.append(dict(id=contrast['id'], legacyLabelConfirmedInBundle=True,
                                  pairs=len(contrast['pairs']), referencePairXCategoryCombinations=combinations))
    manifest = read(WORKSPACE / 'rescue/app/public/audio/manifest.json')
    voices = [v['id'] for v in manifest['voicesByLanguage']['fr']]
    clips = {(r['languageId'], r['text'], r['voiceId']): r for r in manifest['clips']}
    audio_rows = []
    for text, (tokens, meaning, pos, index) in WORDS.items():
        existing = [clips[('fr', text, v)] for v in voices if ('fr', text, v) in clips]
        audio_rows.append(dict(languageId='fr', text=text, ipa='/' + ''.join(tokens.split()) + '/',
            locale='fr-FR', meaning=meaning, alreadyInTraining=normalize(text) in training_words,
            contrastIds=[c['id'] for c in candidate['contrasts'] if any(w['text'] == text for p in c['pairs'] for w in p['words'])],
            existingClips=[dict(voiceId=c['voiceId'], url=c['url'], status=c.get('status')) for c in existing],
            missingVoiceIds=[v for v in voices if ('fr', text, v) not in clips],
            reviewStatus='unreviewed',
            reviewInstruction='Check the declared isolated-word vowel category and consonant frame, naturalness and voice consistency; do not add a final schwa. Natural pre-r vowel length is allowed.' + (' Retain the accent: lé /le/, not le /lə/.' if text == 'lé' else '')))
    missing = sum(len(r['missingVoiceIds']) for r in audio_rows)
    snapshot = dict(hashes=before, currentContrasts=len(all_current),
                    currentPairs=sum(len(c['pairs']) for c in all_current))
    candidate['baseSnapshot'] = snapshot
    write('candidates', candidate)
    write('audio-request', dict(date=DATE, status='request-only-no-audio-generated-or-manifest-changed',
        languageId='fr', locale='fr-FR', voiceIds=voices, uniqueWords=len(WORDS),
        newTrainingWords=[r['text'] for r in audio_rows if not r['alreadyInTraining']],
        missingCachedClips=missing, existingCachedClips=sum(len(r['existingClips']) for r in audio_rows),
        requirement='At least two complete, dialect-consistent profiles require listening review. Existing synthetic profile IDs do not certify stable human speakers. Newly recorded human voices need all 18 words per profile, not only words uncached in the existing synthetic profiles.', words=audio_rows))
    assert all(digest(p) == before[str(p.relative_to(WORKSPACE))] for p in protected), 'Protected files changed during audit'
    write('validation', dict(date=DATE, status='passed-text-and-eligibility-checks-only',
        baseSnapshot=snapshot, contrasts=contrast_rows, pairs=pair_rows,
        totalPairs=len(pair_rows), sourceCheckedUniqueWords=len(sources),
        totalReferencePairXCategoryCombinations=sum(c['referencePairXCategoryCombinations'] for c in contrast_rows),
        transferTextOverlap=[], sameLanguageTransferIpaOverlap=[], protectedFilesUnchanged=True,
        audioReadiness=dict(missingCachedClips=missing, listeningApproval=False),
        limits=['Source/phoneme checks cannot certify generated pronunciations.',
                'Combination counts exclude independent A/B ordering, token, and voice variation; they are not independent-test sample sizes.',
                'No runtime integration, statistical learning result, or demand uplift is asserted.']))
    print(json.dumps(dict(contrasts=len(contrast_rows), pairs=len(pair_rows), sourceCheckedWords=len(sources),
                          crossWordCombinations=sum(c['referencePairXCategoryCombinations'] for c in contrast_rows),
                          missingCachedClips=missing, protectedFilesUnchanged=True)))


if __name__ == '__main__':
    main()
