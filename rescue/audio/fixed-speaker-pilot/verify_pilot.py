#!/usr/bin/env python3
"""Independent engineering checks only; never approves phonetics or speaker identity."""
import collections, hashlib, json, pathlib, statistics, subprocess
from datetime import datetime, timezone
import numpy as np
import soundfile as sf

HERE = pathlib.Path(__file__).resolve().parent
EXPECTED = {'en': {'ship', 'sheep', 'fill', 'feel', 'sit', 'seat'},
            'fr': {'tout', 'tu', 'vous', 'vu', 'roue', 'rue'}}
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(name): return json.loads((HERE/name).read_text())
def main():
    refs=read('references.json')['references']; clips=read('take-inventory.json')['clips']
    manifest=read('manifest.candidate.json'); errors=[]; warnings=[]
    by_voice={r['voiceId']:r for r in refs}
    def check(value,message):
        if not value: errors.append(message)
    check(len(refs)==4 and len(by_voice)==4,'Expected four distinct reference profiles')
    for language,words in EXPECTED.items():
        check(sum(r['languageId']==language for r in refs)==2,f'{language}: expected two profiles')
    for r in refs:
        path=HERE/r['privateWavPath']; data,rate=sf.read(path)
        check(digest(path)==r['referenceSha256'],f'{r["profileKey"]}: reference hash differs')
        check(hashlib.sha256(r['referenceText'].encode()).hexdigest()==r['referenceTextSha256'],f'{r["profileKey"]}: transcript hash differs')
        check(3<=len(data)/rate<=18 and np.isfinite(data).all(),f'{r["profileKey"]}: reference length/finite check')
        check(r['synthetic'] is True and r['status']=='generated-unreviewed',f'{r["profileKey"]}: reference status')
        check(r['phoneticListeningVerified'] is False and r['speakerConsistencyVerified'] is False,f'{r["profileKey"]}: unearned review flag')
    seen=collections.Counter(); hashes=collections.defaultdict(list)
    for c in clips:
        key=(c['languageId'],c['voiceId'],c['text'],c['take']);seen[key]+=1
        path=HERE/'clips'/pathlib.Path(c['url']).name; wav=HERE/c['privateWavPath']; r=by_voice[c['voiceId']]
        check(c['text'] in EXPECTED[c['languageId']],f'{key}: word outside pilot')
        check(c['referenceSha256']==r['referenceSha256'] and c['referenceTextSha256']==r['referenceTextSha256'],f'{key}: reference conditioning differs')
        check(c['baseSpeakerEmbeddingSha256']==r['baseSpeakerEmbeddingSha256'],f'{key}: conditioning embedding differs')
        check(digest(path)==c['sha256'] and digest(wav)==c['sourceWavSha256'],f'{key}: audio hash differs')
        check(path.stat().st_size==c['bytes'],f'{key}: encoded byte count differs')
        check(c['synthetic'] is True and c['status']=='generated-unreviewed',f'{key}: candidate status differs')
        check(c['phoneticListeningVerified'] is False and c['speakerConsistencyVerified'] is False,f'{key}: unearned review flag')
        data,rate=sf.read(wav);check(data.ndim==1 and np.isfinite(data).all(),f'{key}: invalid original waveform')
        check(.16<=len(data)/rate<=3.2 and np.max(np.abs(data))>0,f'{key}: original length/silence')
        check(c['generationTokenCount']<c['maxTokens'],f'{key}: generation token cap')
        decoded=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),'-f','null','-'],capture_output=True,text=True)
        check(decoded.returncode==0 and not decoded.stderr,f'{key}: decoder error {decoded.stderr}')
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=sample_rate,channels:format=duration','-of','json',str(path)],text=True))
        check(len(probe['streams'])==1 and probe['streams'][0]['channels']==1,f'{key}: encoding channels')
        check(int(probe['streams'][0]['sample_rate'])==rate,f'{key}: encoding sample rate')
        check(abs(float(probe['format']['duration'])-len(data)/rate)<.15,f'{key}: encoded duration discrepancy')
        hashes[c['sha256']].append(key)
    for key,count in seen.items():check(count==1,f'{key}: duplicate manifest mapping')
    grouped=collections.defaultdict(list)
    for c in clips:
        grouped[(c['voiceId'],c['text'])].append(c)
        if c['durationSeconds']>2:
            warnings.append({'kind':'long-isolated-word-review','id':c['id'],'text':c['text'],'take':c['take'],'durationSeconds':c['durationSeconds'],'note':'Duration alone cannot prove extra speech; prioritize actual listening.'})
    for (voice,word),takes in grouped.items():
        lengths=[c['durationSeconds'] for c in takes]
        if max(lengths)/min(lengths)>2.5:
            warnings.append({'kind':'take-duration-variation-review','voiceId':voice,'text':word,'ratio':max(lengths)/min(lengths),'note':'Do not normalize blindly; check silence, extra speech and phonetic realization by listening.'})
    for r in refs:
        for word in EXPECTED[r['languageId']]:
            for take in range(3):check(seen[(r['languageId'],r['voiceId'],word,take)]==1,f'{r["voiceId"]}/{word}/{take}: missing take')
    collisions=[keys for keys in hashes.values() if len(keys)>1]
    check(not collisions,'Encoded waveform hashes reused across candidate clips')
    primary=manifest['clips'];check(len(primary)==24,'Primary manifest must contain 24 clips')
    check(all(c['take']==0 for c in primary),'Primary manifest must select only take zero')
    check(len({(c['languageId'],c['text'],c['voiceId']) for c in primary})==len(primary),'Ambiguous primary mappings')
    check(all(c in clips for c in primary),'Primary clip absent from full take inventory')
    check(all(c['completeForListedPairs'] for c in manifest['eligibleContrasts']),'Incomplete primary contrast coverage')
    durations=[c['durationSeconds'] for c in clips];times=[c['generationSeconds'] for c in clips]
    result={'checkedAt':datetime.now(timezone.utc).isoformat(),'status':'engineering-pass' if not errors else 'engineering-fail',
        'referenceCount':len(refs),'clipCount':len(clips),'primaryClipCount':len(primary),'distinctEncodedHashes':len(hashes),
        'encodedBytes':sum(c['bytes'] for c in clips),'primaryEncodedBytes':sum(c['bytes'] for c in primary),
        'durationSeconds':{'min':min(durations),'max':max(durations)},
        'acceptedWordGenerationSeconds':{'min':min(times),'median':statistics.median(times),'max':max(times),'total':sum(times)},
        'errors':errors,'warnings':warnings,'phoneticListeningVerified':False,'speakerConsistencyVerified':False,
        'limitations':['Reference transcript is the synthesis input, not a listening-verified transcription.',
            'Distinct encoded hashes establish distinct files, not phonetic correctness or independent acoustic realizations.',
            'Fixed conditioning establishes reuse of an identical reference input, not an acoustic identity guarantee.',
            'Current public adapter has no multiple-take selection; candidate manifest intentionally exposes one take only.']}
    (HERE/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(bool(errors))
if __name__=='__main__': main()
