#!/usr/bin/env python3
"""Independently validate the complete staged candidate; no network requests."""
import hashlib, json, pathlib, subprocess

BASE = pathlib.Path(__file__).resolve().parent
m = json.loads((BASE / 'manifest.candidate.json').read_text())
expected = {'human-en-grendelkhan':'CC0-1.0', 'human-en-dvortygirl':'CC-BY-SA-3.0'}
words = {'ship','sheep','fill','feel','sit','seat'}
assert set(m['voicesByLanguage']) == {'en'}
assert {v['id'] for v in m['voicesByLanguage']['en']} == set(expected)
assert len(m['clips']) == 12
assert {(c['voiceId'],c['text']) for c in m['clips']} == {(v,w) for v in expected for w in words}
assert m['eligibleContrasts'] == [{'languageId':'en','contrastId':'en-i-ih','pairIds':['en-ship-sheep','en-fill-feel','en-sit-seat'],'completeForListedPairs':True,'completeForEntireContrast':True}]
assert len({c['sha256'] for c in m['clips']}) == 12, 'Duplicate encoded recording across words or speakers'
assert len({c['originalSha256'] for c in m['clips']}) == 12, 'Duplicate source recording across words or speakers'
paths = set()
for c in m['clips']:
    assert c['status'] == 'source-verified-unreviewed' and c['synthetic'] is False and c['phoneticListeningVerified'] is False
    assert c['sourceTranscription'] == c['text'] == c['sourceTranscriptionEvidence']['text']
    assert c['license']['id'] == expected[c['voiceId']]
    assert c['license']['shareAlike'] == (c['voiceId'] == 'human-en-dvortygirl')
    assert c['license']['attributionRequired'] == (c['voiceId'] == 'human-en-dvortygirl')
    assert c['url'].startswith('/audio/human-en-i-ih/clips/')
    assert c['sampleRate'] == 44100 and c['channels'] == 1
    if c['voiceId'] == 'human-en-grendelkhan':
        assert c['sourceTranscriptionEvidence']['kind'] == 'Commons MediaInfo exact transcription (P9533)'
    else:
        assert 'filename-only' in c['sourceTranscriptionEvidence']['kind'] or c['text'] == 'fill'
    path = BASE / 'clips' / pathlib.Path(c['url']).name; paths.add(path.name)
    data = path.read_bytes()
    assert len(data) == c['bytes'] and hashlib.sha256(data).hexdigest() == c['sha256']
    original = BASE / c['originalPrivatePath']; data = original.read_bytes()
    assert hashlib.sha256(data).hexdigest() == c['originalSha256']
    assert hashlib.sha1(data).hexdigest() == c['sourceSha1']
    subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),'-f','null','-'], check=True, stdout=subprocess.DEVNULL)
    stream = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=sample_rate,channels','-of','json',str(path)],text=True))['streams'][0]
    assert stream['sample_rate'] == '44100' and stream['channels'] == 1
assert {p.name for p in (BASE/'clips').iterdir() if p.is_file()} == paths
print(json.dumps({'complete':True,'speakers':2,'pairs':3,'files':12,'audioBytes':sum(c['bytes'] for c in m['clips']),
    'uniqueOriginalAndOutputHashes':True,'allSourceAndOutputHashesMatch':True,'decodedAllFiles':True,'perFileLicensesPreserved':True,'phoneticListeningVerified':False}))
