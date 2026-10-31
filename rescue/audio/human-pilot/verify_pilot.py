#!/usr/bin/env python3
"""Check the complete private pilot without requesting network resources."""
import hashlib,json,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent
m=json.loads((BASE/'manifest.candidate.json').read_text())
expected_voices={'human-fr-sartus85':'CC-BY-SA-4.0','human-fr-poslovitch':'CC0-1.0'}
words={'tout','tu','vous','vu','roue','rue'}
assert set(v['id'] for v in m['voicesByLanguage']['fr'])==set(expected_voices)
assert len(m['clips'])==12
assert {(c['voiceId'],c['text']) for c in m['clips']}=={(v,w) for v in expected_voices for w in words}
assert m['eligibleContrasts'][0]['pairIds']==['fr-tout-tu','fr-vous-vu','fr-roue-rue']
assert m['eligibleContrasts'][0]['completeForEntireContrast'] is False
paths=set()
for c in m['clips']:
 assert c['status']=='source-verified-unreviewed' and c['synthetic'] is False and c['phoneticListeningVerified'] is False
 assert c['sourceTranscription']==c['text']
 assert c['license']['id']==expected_voices[c['voiceId']]
 assert c['license']['shareAlike']==(c['voiceId']=='human-fr-sartus85')
 assert c['url'].startswith('/audio/human-fr-u-y/clips/')
 p=BASE/'clips'/pathlib.Path(c['url']).name;paths.add(p.name)
 data=p.read_bytes();assert len(data)==c['bytes'];assert hashlib.sha256(data).hexdigest()==c['sha256']
 original=BASE/c['originalPrivatePath'];data=original.read_bytes()
 assert hashlib.sha256(data).hexdigest()==c['originalSha256'] and hashlib.sha1(data).hexdigest()==c['sourceSha1']
 subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(p),'-f','null','-'],check=True,stdout=subprocess.DEVNULL)
assert {p.name for p in (BASE/'clips').iterdir() if p.is_file()}==paths,'Unexpected candidate asset outside manifest'
print(json.dumps({'complete':True,'speakers':2,'pairs':3,'files':12,'audioBytes':sum(c['bytes'] for c in m['clips']),'allSourceAndOutputHashesMatch':True,'decodedAllFiles':True,'perFileLicensesPreserved':True,'phoneticListeningVerified':False}))
