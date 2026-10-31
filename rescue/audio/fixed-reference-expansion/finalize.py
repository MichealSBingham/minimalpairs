#!/usr/bin/env python3
"""Package the bounded experiment; never generate or publish audio."""
import hashlib, importlib.metadata, json, pathlib, shutil, sys
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
PILOT = HERE.parent / 'fixed-speaker-pilot'

def read(path):
    return json.loads(path.read_text())

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def write(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

full = read(HERE / 'manifest.preview.json')
summary = read(HERE / 'run-summary.json')
prior = read(PILOT / 'provenance.json')
(HERE / 'provenance').mkdir(exist_ok=True)

# Verify the existing pinned artifacts again without network access or model loading.
models = prior['models']
for model in models:
    cache = pathlib.Path.home() / '.cache/huggingface/hub' / ('models--' + model['repo'].replace('/', '--')) / 'snapshots' / model['revision']
    for item in model['retainedMetadata']:
        original = cache / item['originalPath']
        assert sha(original) == item['sha256']
        shutil.copyfile(original, HERE / item['retainedPath'])
    for item in model['weights']:
        original = cache / item['file']
        assert original.stat().st_size == item['bytes'] and sha(original) == item['sha256']
    assert 'license: apache-2.0' in (cache / 'README.md').read_text().lower()

sources = []
package = pathlib.Path(importlib.metadata.distribution('mlx-audio').locate_file('mlx_audio'))
for item in prior['runtimeSourceHashes']:
    digest = sha(package.parent / item['packagePath'])
    assert digest == item['sha256']
    sources.append({**item, 'recheckedUnchanged': True})

write('provenance.json', {
    'recordedAt': datetime.now(timezone.utc).isoformat(),
    'originProvenanceSha256': sha(PILOT / 'provenance.json'),
    'models': models, 'runtimeSourceHashes': sources,
    'versions': summary['runtimeVersions'], 'pythonVersion': sys.version,
    'sourceReferences': prior['sourceReferences'],
    'conditioning': prior['conditioning'], 'rightsNote': prior['rightsNote'],
    'referencePolicy': 'Reuse only the four accepted, original fictional references. No real-person recordings, new anchors or mixed-reference repairs.',
    'generationSettings': full['clips'][0]['generationSettings'],
    'allModelAndRuntimeHashesRechecked': True,
    'newModelDownloads': False, 'paidAPIRequests': 0,
    'publicAudioChanged': False,
})

# Keep a scopes-with-complete-file-coverage manifest separate from the inspection inventory.
complete = json.loads(json.dumps(full))
complete['collectionId'] = 'fixed-reference-expansion-complete-v1'
complete['eligibleContrasts'] = [s for s in full['eligibleContrasts'] if s['completeForListedPairs']]
scope_ids = {s['contrastId'] for s in complete['eligibleContrasts']}
complete['clips'] = [c for c in full['clips'] if scope_ids.intersection(c['contrastIds'])]
complete['conditionalPairs'] = full['conditionalPairs'] if 'en-zh-j' in scope_ids else []
complete['scopeNote'] = 'Only scopes with complete two-profile file coverage are included. Audio remains generated and unreviewed. Version/virgin and French rat require conditional target-reading review. English B lesion uses the documented Lesion. capitalization/punctuation repair.'
complete['withheldScopes'] = [s for s in full['eligibleContrasts'] if not s['completeForListedPairs']]
assert {'en-foot-strut', 'en-ae-strut', 'fr-a-an'} <= scope_ids
assert len(complete['clips']) == (46 if 'en-zh-j' in scope_ids else 34)
for scope in complete['eligibleContrasts']:
    for profile in complete['voicesByLanguage'][scope['languageId']]:
        for word in {w for pair in scope['pairs'] for w in pair['words']}:
            assert sum(c['voiceId'] == profile['id'] and c['text'] == word for c in complete['clips']) == 1
write('manifest.complete-scopes.preview.json', complete)

inventory = read(HERE / 'integration-inventory.json')
complete_ids = {c['sha256'] for c in complete['clips']}
inventory['fullSetStatus'] = 'complete file coverage; pronunciation and speaker identity unreviewed' if not summary['unavailable'] else 'incomplete: English B lesion returned immediate EOS on three attempts'
inventory['completeScopeManifest'] = 'manifest.complete-scopes.preview.json'
inventory['completeScopeFiles'] = [f for f in inventory['files'] if f['sha256'] in complete_ids]
inventory['completeScopeCount'] = len(inventory['completeScopeFiles'])
inventory['completeScopeBytes'] = sum(f['bytes'] for f in inventory['completeScopeFiles'])
inventory['inspectionOnlyFiles'] = [f for f in inventory['files'] if f['sha256'] not in complete_ids]
inventory['integrationGate'] = 'Optional comparison only after root review. No silent profile mixing or browser/default fallback. Preserve the lesion input-change record and original failed attempts. File completeness is not listening approval.'
write('integration-inventory.json', inventory)

review = {
    'status': 'not-reviewed',
    'instructions': 'Listen before marking any result. Judge pronunciation and same-profile identity separately from pleasantness. Use pass/fail/uncertain; do not infer pass from duration, transcript, model input, playback-ended or successful decoding.',
    'referenceChecks': [{'voiceId': r['voiceId'], 'referenceSha256': r['referenceSha256'], 'suppliedText': r['referenceText'], 'actualTextMatches': None, 'notes': ''} for r in read(HERE / 'references.json')['references']],
    'clips': [{
        'id': c['id'], 'languageId': c['languageId'], 'text': c['text'],
        'targetIPA': c['targetIPA'], 'voiceId': c['voiceId'],
        'localPath': 'clips/' + pathlib.Path(c['url']).name,
        'sha256': c['sha256'], 'conditionalReadingRequired': c['conditionalReadingRequired'],
        'reviewInstruction': c['reviewInstruction'], 'exactWord': None,
        'targetContrast': None, 'sameSpeakerAsReference': None,
        'extraSpeechOrClipping': None, 'naturalness': None, 'notes': ''
    } for c in full['clips']],
    'missing': summary['unavailable'],
    'pairChecks': [{'contrastId': s['contrastId'], 'pairId': p['id'], 'voiceId': voice['id'], 'words': p['words'], 'sharedPhonemesMatch': None, 'contrastPresent': None, 'notes': ''} for s in full['eligibleContrasts'] for p in s['pairs'] for voice in full['voicesByLanguage'][s['languageId']]],
    'pronunciationApproved': False, 'speakerConsistencyApproved': False,
}
write('listening-review.template.json', review)
for name in ['manifest.preview.json', 'manifest.complete-scopes.preview.json', 'reference-provenance.public.json']:
    text = (HERE / name).read_text()
    assert '/Users/' not in text and 'private/' not in text
print(json.dumps({'primaryClips': len(full['clips']), 'completeScopeClips': len(complete['clips']), 'completeScopeBytes': inventory['completeScopeBytes'], 'incompleteScopes': [s['contrastId'] for s in complete['withheldScopes']], 'provenanceHashesRechecked': True, 'publicAudioChanged': False}))
