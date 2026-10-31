#!/usr/bin/env python3
"""Read existing audio only; write this isolated handoff, never synthesize/publish."""
import copy
import hashlib
import json
import pathlib
import subprocess
import unicodedata
from datetime import datetime, timezone

import numpy as np
import soundfile as sf

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE.parent
ROOT = HERE.parents[3]
SCOPES = ['en-zh-j', 'en-foot-strut', 'en-ae-strut']

def load(path):
    return json.loads(path.read_text())

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def textkey(value):
    return unicodedata.normalize('NFC', value).strip().casefold()

def ipakey(value):
    return unicodedata.normalize('NFC', value).strip('/[] ').replace('ˈ', '').replace('ː', '').replace('ɜr', 'ɝ').replace('r', 'ɹ').replace('g', 'ɡ').replace(' ', '')

def decode(path, clip):
    result = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(path), '-f', 'null', '-'], capture_output=True, text=True, check=True)
    assert not result.stderr, clip['id'] + ': decoder warning'
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'stream=sample_rate,channels:format=duration', '-of', 'json', str(path)], text=True))
    assert len(info['streams']) == 1 and info['streams'][0] == {'sample_rate': '24000', 'channels': 1}
    assert abs(float(info['format']['duration']) - clip['durationSeconds']) < .15

def main():
    paths = [SOURCE / name for name in ['manifest.preview.json', 'manifest.candidate.json', 'references.json', 'reference-provenance.public.json', 'scope-snapshot.json', 'provenance.json', 'integration-inventory.json', 'repair-lesion-result.json']]
    paths += [ROOT / 'rescue/content/curriculum.json', ROOT / 'rescue/content/transfer-candidates.json']
    before = {str(p.relative_to(ROOT)): sha(p) for p in paths}
    public = load(SOURCE / 'manifest.preview.json')
    private = load(SOURCE / 'manifest.candidate.json')
    refs = load(SOURCE / 'references.json')['references']
    pilot = load(SOURCE.parent / 'fixed-speaker-pilot/references.json')['references']
    provenance = load(SOURCE / 'provenance.json')
    assert len(public['clips']) == 46
    assert len({(c['languageId'], c['text'], c['voiceId']) for c in public['clips']}) == 46
    assert len({c['sha256'] for c in public['clips']}) == 46
    assert len({c['sourceWavSha256'] for c in public['clips']}) == 46
    for ref in refs:
        prior = next(r for r in pilot if r['voiceId'] == ref['voiceId'])
        for key in ['referenceSha256', 'referenceTextSha256', 'baseSpeakerEmbeddingSha256', 'referenceText', 'referenceModelRevision']:
            assert ref[key] == prior[key]
        assert sha(SOURCE / ref['privateWavPath']) == ref['referenceSha256']
        assert hashlib.sha256(ref['referenceText'].encode()).hexdigest() == ref['referenceTextSha256']
    for model in provenance['models']:
        assert model['modelCardLicense'] == 'Apache-2.0'
        for item in model['retainedMetadata']:
            assert sha(SOURCE / item['retainedPath']) == item['sha256']
    for c in public['clips']:
        original = next(x for x in private['clips'] if x['id'] == c['id'])
        assert {k: v for k, v in original.items() if k not in ['privateWavPath', 'privateReferencePath']} == c
        mp3 = SOURCE / 'clips' / pathlib.Path(c['url']).name
        assert sha(mp3) == c['sha256'] and mp3.stat().st_size == c['bytes']
        assert sha(SOURCE / original['privateWavPath']) == c['sourceWavSha256']
        data, rate = sf.read(SOURCE / original['privateWavPath'])
        assert rate == 24000 and data.ndim == 1 and np.isfinite(data).all()
        assert float(np.sqrt(np.mean(data.astype(np.float64) ** 2))) >= .00005
        assert .16 <= len(data) / rate <= 3.2
        decode(mp3, c)
        cachekey = hashlib.sha256(json.dumps(c['generationSettings'], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:28]
        assert cachekey == c['id'] == mp3.stem
        ref = next(r for r in refs if r['voiceId'] == c['voiceId'])
        for key in ['referenceSha256', 'referenceTextSha256', 'baseSpeakerEmbeddingSha256']:
            assert c[key] == ref[key] == c['generationSettings'].get(key, c[key])
        assert c['synthetic'] is True and c['status'] == 'generated-unreviewed' and c['take'] == 0
        assert all(c[k] is False for k in ['phoneticListeningVerified', 'speakerConsistencyVerified', 'assessmentApproved'])
        assert c['modelRevision'] == '0d6bb6fe33f92d47a507e23b9148940e8366ab5b'
        if c['text'] == 'lesion' and c['voiceId'] == 'qwen-fixed-en-b-fc29c14c':
            assert c['ttsText'] == c['generationSettings']['text'] == 'Lesion.'
            assert c['generationSettings']['intendedWord'] == 'lesion'
            assert c['generationSettings']['attemptSeries'] == 'lesion-capitalization-punctuation-repair'
        else:
            assert c['generationSettings']['text'] == c['text']
    main = load(ROOT / 'rescue/content/curriculum.json')
    english = next(l for l in main['languages'] if l['id'] == 'en')
    reserved = load(ROOT / 'rescue/content/transfer-candidates.json')
    reserved_text = {textkey(w['text']) for s in reserved['sets'] for p in s['pairs'] for w in p['words']}
    reserved_ipa = {ipakey(w['ipa']) for s in reserved['sets'] if s['languageId'] == 'en' for p in s['pairs'] for w in p['words']}
    selected = [c for c in public['clips'] if c['languageId'] == 'en']
    voice_ids = [v['id'] for v in public['voicesByLanguage']['en']]
    assert len(selected) == 34 and len(voice_ids) == 2
    lookup = {(c['text'], c['voiceId']): c for c in selected}
    scope_results = []
    for sid in SCOPES:
        contrast = next(c for c in english['contrasts'] if c['id'] == sid)
        declared = next(s for s in public['eligibleContrasts'] if s['contrastId'] == sid)
        assert [p['id'] for p in contrast['pairs']] == declared['pairIds']
        combinations = 0
        for pair in contrast['pairs']:
            index = pair['abx']['targetTokenIndex']
            assert pair['abx']['categoryByWordIndex'] == [0, 1]
            assert [i for i, (a, b) in enumerate(zip(*[w['phonemes'] for w in pair['words']] )) if a != b] == [index]
            assert len(pair['words'][0]['phonemes']) == len(pair['words'][1]['phonemes'])
            assert next(p['words'] for p in declared['pairs'] if p['id'] == pair['id']) == [w['text'] for w in pair['words']]
            for category, word in enumerate(pair['words']):
                assert word['phonemes'][index] == contrast['phonemes'][category]
                assert textkey(word['text']) not in reserved_text and ipakey(word['ipa']) not in reserved_ipa
                for voice in voice_ids:
                    clip = lookup[word['text'], voice]
                    assert clip['targetIPA'] == word['ipa'] and sid in clip['contrastIds'] and pair['id'] in clip['pairIds']
                    assert clip['intendedLocale'] == 'en-US'
                for test in contrast['pairs']:
                    if test['id'] != pair['id'] and test['abx']['trialGroup'] == pair['abx']['trialGroup']:
                        assert test['words'][category]['text'] not in {w['text'] for w in pair['words']}
                        assert test['words'][category]['phonemes'][test['abx']['targetTokenIndex']] == contrast['phonemes'][category]
                        combinations += 1
        scope_results.append({'languageId': 'en', 'contrastId': sid, 'pairIds': declared['pairIds'], 'pairCount': 3, 'profileCount': 2, 'clipMappings': 12, 'crossWordCombinations': combinations, 'completeFileCoverage': True, 'pronunciationApproved': False})
    old_public = load(ROOT / 'rescue/app/public/audio/fixed-speaker-pilot/manifest.json')
    old_local = load(SOURCE.parent / 'fixed-speaker-pilot/manifest.preview.json')
    assert len(old_public['clips']) == len(old_local['clips']) == 24
    for clip in old_local['clips']:
        published = next(c for c in old_public['clips'] if (c['text'], c['voiceId'], c['languageId']) == (clip['text'], clip['voiceId'], clip['languageId']))
        assert published['sha256'] == clip['sha256'] and clip['take'] == 0
        path = ROOT / 'rescue/app/public' / clip['url'].lstrip('/')
        assert sha(path) == clip['sha256']
        decode(path, clip)
    # Copy metadata only. Existing sources, rejected attempts and audio bytes remain intact.
    handoff = copy.deepcopy(public)
    handoff.update(collectionId='owner-fixed-reference-english-v1', status='isolated-owner-validation-candidate', clips=selected, voicesByLanguage={'en': public['voicesByLanguage']['en']}, eligibleContrasts=[s for s in public['eligibleContrasts'] if s['contrastId'] in SCOPES], audioSourceKind='synthetic-fixed-reference', scopeNote='Three current English contrasts, two fictional reference-conditioned profiles. Owner listening validation only; not a default replacement or approved assessment.', targetIPAMechanism='IPA is review metadata, not synthesis control. Original words were supplied except English B lesion, explicitly supplied as Lesion.; exact inputs are retained per clip.')
    handoff['ownerReviewWarnings'] = ['Exact spoken content, intended accent and audible speaker consistency are unreviewed.', 'Version/virgin must share the authored schwa ending; another attested variant does not satisfy this pair.', 'English B lesion uses the recorded capitalization/punctuation repair; English B cap needs a clipping check.', 'One token per word/profile can be memorized; fixed reference input does not prove stable audible identity.']
    safe_refs = load(SOURCE / 'reference-provenance.public.json')
    safe_refs['references'] = [r for r in safe_refs['references'] if r['languageId'] == 'en']
    for obj in [handoff, safe_refs]:
        raw = json.dumps(obj)
        assert '/Users/' not in raw and 'private/' not in raw and 'privateWavPath' not in raw
    write('manifest.preview.json', handoff)
    write('references.public.json', safe_refs)
    inventory = {'schemaVersion': 1, 'collectionId': handoff['collectionId'], 'status': 'isolated-owner-validation-candidate', 'sourceManifest': 'rescue/audio/fixed-reference-expansion/manifest.preview.json', 'sourceManifestSha256': sha(SOURCE / 'manifest.preview.json'), 'manifestPath': 'rescue/audio/fixed-reference-expansion/owner-validation-handoff-2026-09-28/manifest.preview.json', 'manifestSha256': sha(HERE / 'manifest.preview.json'), 'scope': scope_results, 'clips': len(selected), 'bytes': sum(c['bytes'] for c in selected), 'copyAllowlist': [{'sourcePath': 'rescue/audio/fixed-reference-expansion/clips/' + pathlib.Path(c['url']).name, 'destinationUrl': c['url'], 'languageId': c['languageId'], 'text': c['text'], 'voiceId': c['voiceId'], 'sha256': c['sha256'], 'bytes': c['bytes']} for c in selected], 'excluded': ['French clips', 'raw anchors', 'original WAVs', 'rejected or alternate takes', 'private source manifests', 'source snapshots'], 'defaultReplacementApproved': False, 'assessmentApproved': False, 'integrationRequirements': ['Use a distinct owner-review source and preserve source ID in progress/history.', 'Use all three exact English scopes; no browser/default fallback or voice-profile mixing.', 'Display synthetic/unreviewed status and the conditional version/virgin plus repaired lesion notes.', 'Copy only the explicit 34-file allowlist and public-safe metadata; retain source artifacts untouched.']}
    write('integration-inventory.json', inventory)
    assert all(sha(ROOT / p) == digest for p, digest in before.items()), 'Source changed during audit'
    result = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'status': 'engineering-pass-owner-listening-unreviewed', 'expansionClipsDecoded': 46, 'priorPublishedPilotClipsDecoded': 24, 'newEnglishPreviewClips': 34, 'newEnglishPreviewBytes': inventory['bytes'], 'scope': scope_results, 'reservedTextCollisions': [], 'reservedEnglishIPACollisions': [], 'sourceArtifactsUnchanged': True, 'inputHashes': before, 'phoneticListeningVerified': False, 'speakerConsistencyVerified': False, 'audioGenerated': 0, 'publishedFilesWritten': 0, 'errors': []}
    write('verification.json', result)
    print(json.dumps({k: v for k, v in result.items() if k != 'inputHashes'}, indent=2))

if __name__ == '__main__':
    main()
