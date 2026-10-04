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
PREFIX = 'french-legacy-batch3'
DATE = '2026-09-28'
NASAL_STUDY = 'https://assta.org/proceedings/ICPhS2019Microsite/pdf/full-paper_37.pdf'
ARTICULATION = 'https://experts.illinois.edu/en/publications/a-real-time-mri-investigation-of-the-role-of-lingual-and-pharynge/'
WORDS = {
    'beau': ('b o', 'beautiful; masculine singular', 'adjectif', 0),
    'bout': ('b u', 'end; tip', 'nom', 0),
    'veau': ('v o', 'calf', 'nom', 0),
    'vous': ('v u', 'you, formal or plural', 'pronom', 0),
    'saut': ('s o', 'jump', 'nom', 0),
    'sou': ('s u', 'a small coin; a little money', 'nom', 0),
    'chat': ('ʃ a', 'cat; masculine form', 'nom', 0),
    'chant': ('ʃ ɑ̃', 'singing; song', 'nom', 0),
    'rat': ('ʁ a', 'rat', 'nom', 0),
    'rang': ('ʁ ɑ̃', 'row; rank', 'nom', 0),
    'plat': ('p l a', 'flat; masculine singular', 'adjectif', 0),
    'plan': ('p l ɑ̃', 'plan; drawing of a layout', 'nom', 1),
    'bon': ('b ɔ̃', 'good; masculine singular', 'adjectif', 0),
    'peau': ('p o', 'skin', 'nom', 0),
    'pont': ('p ɔ̃', 'bridge', 'nom', 0),
    'taux': ('t o', 'rate', 'nom', 0),
    'ton': ('t ɔ̃', 'tone; pitch of a voice', 'nom', 1),
}
SPECS = [
    dict(id='fr-o-u', legacy='/french/o-vs-ou', component='v1',
         legacyLabel='o vs ou (/o/ vs /u/)', label='Beau or bout?', phonemes=['o', 'u'],
         pairs=[('beau', 'bout'), ('veau', 'vous'), ('saut', 'sou')],
         description='Listen for the final rounded vowel. These pairs contrast close-mid /o/ with close /u/; neither category is the open-mid /ɔ/ of the separate o ouvert lesson.',
         dialectNote='Reference Metropolitan French in isolated words. Keep /o/ separate from /ɔ/ and /u/ separate from /y/. Do not insert an English-style off-glide as the target.',
         notes=[dict(nativeLanguage='en', note='Both vowels are taught as single French vowel categories. The English vowels in go and boot are approximate comparisons, not target recordings.'),
                dict(nativeLanguage='es', note='The letters ou represent /u/ in these examples; attend to the sound before enabling spelling hints.')],
         priorityEvidence='The saved Search Console audit explicitly lists this legacy URL among crawled/not-indexed pages. A click count for this URL was not saved.'),
    dict(id='fr-a-an', legacy='/french/a-vs-an', component='B1',
         legacyLabel='a vs an (/a/ vs /ɑ̃/)', label='Chat or chant?', phonemes=['a', 'ɑ̃'],
         pairs=[('chat', 'chant'), ('rat', 'rang'), ('plat', 'plan')],
         description='Listen to the final vowel: oral /a/ or nasal /ɑ̃/. The nasal vowel is one sound, with no added n or ng consonant in these isolated words. Its oral quality may differ too.',
         dialectNote='Northern reference Metropolitan French broad phonemic notation. TLFi gives rat /ʁa/ and also reports historical /ʁɑ/ variation; this candidate explicitly selects /a/. A recording with oral /ɑ/ must not be silently accepted for the /a/ category. Nasal quality varies across regions and speakers.',
         notes=[dict(nativeLanguage='en', note='Listen for a nasal vowel rather than a vowel followed by an English n or ng.'),
                dict(nativeLanguage='es', note='The final written n, ng, and nt do not add a spoken nasal consonant to these isolated target words.')],
         priorityEvidence='A saved customer case requested more French nasal-vowel work. This combines that request with French-hub search demand; no contrast-specific click rank is available.'),
    dict(id='fr-o-on', legacy='/french/o-vs-on', component='X1',
         legacyLabel='o vs on (/o/ vs /ɔ̃/)', label='Beau or bon?', phonemes=['o', 'ɔ̃'],
         pairs=[('beau', 'bon'), ('peau', 'pont'), ('taux', 'ton')],
         description='Listen to the final vowel: oral /o/ or nasal /ɔ̃/. In these isolated words, the nasal spelling does not add a separate n consonant. The contrast can include vowel-quality differences as well as nasalization.',
         dialectNote='Northern reference Metropolitan French, in isolation. Broad /ɔ̃/ does not require a literal nasalized copy of oral /o/ or /ɔ/ in every voice. Bon here is isolated masculine /bɔ̃/; its feminine and some liaison forms are different. Do not merge this lesson with oral /o–ɔ/.',
         notes=[dict(nativeLanguage='en', note='Bon does not end with the n consonant of English bone. Listen to its complete vowel.'),
                dict(nativeLanguage='es', note='Compare whole vowel categories. Adding a spoken n to /o/ is not the target for bon, pont, or ton.')],
         priorityEvidence='A saved customer case requested more French nasal-vowel work. This restores the distinct legacy /o–ɔ̃/ topic; it is not the already-covered /o–ɔ/ topic.'),
]


def read(path):
    return json.loads(path.read_text())


def write(suffix, value):
    (ROOT / f'{PREFIX}-{suffix}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(text):
    return unicodedata.normalize('NFC', text).casefold().strip()


def source_url(text):
    return 'https://www.portail-lexical.fr/definition/tlfi/' + quote(text) + '/' + WORDS[text][2]


def broad(ipa):
    # Never change a to ɑ, o to ɔ, or oral to nasal vowels.
    return unicodedata.normalize('NFC', ipa.replace('ʀ', 'ʁ').replace('ε', 'ɛ'))


def refresh_sources():
    rows = []
    for text, (tokens, meaning, pos, index) in WORDS.items():
        url = 'https://www.portail-lexical.fr/api/word/' + quote(text) + '/' + pos
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
            normalization='Historical TLFi ʀ → broad ʁ and ε → ɛ only. No vowel-quality merger.',
            lexicalSenseReviewed=True,
            broadIpaMatchesSelectedEntry=''.join(tokens.split()) in [broad(x) for x in ipa]))
        print(text, rows[-1]['editorialIpa'], rows[-1]['broadIpaMatchesSelectedEntry'], flush=True)
    write('source-audit', dict(date=DATE, sourcePolicy='Bounded editorial verification of 17 lexemes. Only source identifiers and pronunciation facts retained; glosses authored independently. No dictionary audio copied.', words=rows))


def make_candidates():
    contrasts = []
    for spec in SPECS:
        pairs = []
        for first, second in spec['pairs']:
            words = [dict(text=t, ipa='/' + ''.join(WORDS[t][0].split()) + '/',
                          meaning=WORDS[t][1], phonemes=WORDS[t][0].split()) for t in [first, second]]
            pair = dict(id='fr-' + first + '-' + second, words=words, kind='minimal',
                sources=[source_url(first), source_url(second)],
                validation=dict(text='source-checked-candidate', audio='pending-listening-review'),
                abx=dict(categoryByWordIndex=[0, 1], targetTokenIndex=len(words[0]['phonemes']) - 1,
                         targetPosition='final', trialGroup='monosyllabic-final-vowel'))
            if first == 'rat':
                pair['note'] = 'Select the dictionary /ʁa/ variant. TLFi also documents /ʁɑ/: audio must be reviewed against the selected /a/ target.'
            pairs.append(pair)
        focus = 'Listen to the final vowel. The first consonant or consonant cluster changes in X; match the vowel category, not the whole word.'
        contrasts.append(dict(id=spec['id'], label=spec['label'], phonemes=spec['phonemes'],
            description=spec['description'], l1Notes=spec['notes'], pairs=pairs,
            dialectNote=spec['dialectNote'], sources=[NASAL_STUDY, ARTICULATION] if spec['id'] != 'fr-o-u' else sorted({u for p in pairs for u in p['sources']}),
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
                       practiceInstruction='Listen to A, B, and a different word X. Choose the reference with the same final vowel as X. Word text, spelling, IPA, and meanings stay hidden unless hints are explicitly enabled.',
                       audioStatus='Candidate only. Existing cached clips are generated and unreviewed; new words have no cached clips. No release or listening approval is implied.')))
    return dict(schemaVersion='1.0.0', batchId=PREFIX, createdAt=DATE,
                status='source-checked-isolated-candidates-not-live', releaseReady=False,
                languageId='fr', locale='fr-FR', dialect='Northern reference Metropolitan French; isolated words',
                scope='Three missing legacy topics selected from limited saved demand evidence, not a measured top-three click ranking.',
                integration=dict(inLiveCurriculum=False, inDefaultAudioManifest=False, routesPublished=False),
                licensing=dict(text='Original explanations and glosses. Dictionary links and pronunciation facts provide evidence; no dictionary paragraphs or recordings included.', audio='Separate provider/license and pronunciation review required; this artifact grants no rights to dictionary or research audio.'),
                contrasts=contrasts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh-sources', action='store_true')
    args = parser.parse_args()
    protected = [ROOT / 'curriculum.json', ROOT / 'legacy-coverage.json', ROOT / 'transfer-candidates.json',
                 WORKSPACE / 'rescue/app/public/audio/manifest.json']
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
    all_pair_ids = {p['id'] for c in all_current for p in c['pairs']}
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
    assert all(c['id'] not in {x['id'] for x in all_current} for c in candidate['contrasts'])
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
            a, b = [w['phonemes'] for w in pair['words']]
            different = [i for i, (left, right) in enumerate(zip(a, b)) if left != right]
            assert len(a) == len(b) and different == [pair['abx']['targetTokenIndex']]
            assert [a[different[0]], b[different[0]]] == contrast['phonemes']
            assert different[0] == len(a) - 1
            for word in pair['words']:
                assert word['ipa'] == sources[word['text']]['editorialIpa']
            references = {normalize(w['text']) for w in pair['words']}
            eligible = [[p['words'][category]['text'] for p in contrast['pairs']
                         if p['id'] != pair['id'] and p['abx']['trialGroup'] == pair['abx']['trialGroup']
                         and normalize(p['words'][category]['text']) not in references] for category in (0, 1)]
            assert all(len(items) >= 2 for items in eligible)
            combinations += sum(map(len, eligible))
            pair_rows.append(dict(id=pair['id'], strictMinimal=True, categoryAligned=True,
                                  targetPosition='final', eligibleDifferentXByCategory=eligible))
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
            reviewInstruction='Check isolated-word final vowel category, naturalness, and voice consistency; do not add a final consonant or schwa.' + (' Select /ʁa/, not the attested alternate /ʁɑ/.' if text == 'rat' else '')))
    missing = sum(len(r['missingVoiceIds']) for r in audio_rows)
    snapshot = dict(hashes=before, currentContrasts=len(all_current),
                    currentPairs=sum(len(c['pairs']) for c in all_current))
    candidate['baseSnapshot'] = snapshot
    write('candidates', candidate)
    write('audio-request', dict(date=DATE, status='request-only-no-audio-generated-or-manifest-changed',
        languageId='fr', locale='fr-FR', voiceIds=voices, uniqueWords=len(WORDS),
        newTrainingWords=[r['text'] for r in audio_rows if not r['alreadyInTraining']],
        missingCachedClips=missing, existingCachedClips=sum(len(r['existingClips']) for r in audio_rows),
        requirement='At least two complete, dialect-consistent profiles require listening review. Existing synthetic profile IDs do not certify stable human speakers. Newly recorded human voices need all 17 words per profile, not only the six currently uncached words.', words=audio_rows))
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
