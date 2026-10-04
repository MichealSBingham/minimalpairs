import json,shutil
import studio as s
bank=json.loads((s.STATE/'english-integration-manifest.json').read_text())
assert bank['clipCount']==1000
app=s.ROOT/'rescue/app'; out=app/'public/audio/chatterbox-us';out.mkdir(exist_ok=True)
manifest={'collectionId':bank['collectionId'],'voicesByLanguage':{'en':[{'id':'chatterbox-us-'+v,'name':'Voice '+v,'source':'synthetic-fixed-reference'} for v in bank['voices']]},'clips':[]}
for clip in bank['clips']:
    source=s.STATE/clip['relativeAudioPath'];assert s.sha(source.read_bytes())==clip['sha256']
    filename=clip['clipId']+'-'+clip['sha256'][:12]+'.wav';shutil.copy2(source,out/filename)
    manifest['clips'].append({'id':clip['clipId'],'wordId':clip['wordId'],'languageId':'en','bankId':'en-US-ga','text':clip['text'],'ipa':clip['ipa'],'voiceId':'chatterbox-us-'+clip['voiceId'],'url':'/audio/chatterbox-us/'+filename,'sha256':clip['sha256'],'status':'unreviewed','synthetic':True,'provider':'chatterbox','memberships':clip['memberships']})
(out/'manifest.json').write_text(s.dumps(manifest))
snapshot=json.loads(s.SNAPSHOT.read_text());contrasts=[]
for c in snapshot['contrasts']:
    if c.get('varietyId')!='en-US-ga':continue
    pairs=[];seen=set()
    for group in c['contextGroups']:
        pools=[[m for m in pool if m['group']==group['id']] for pool in c['pools']]
        if not all(pools):continue
        # Keep references within the authored target context. Include every pool word.
        combos=[(a,b) for a in pools[0] for b in pools[1] if any(p['leftWordId']==a['wordId'] and p['rightWordId']==b['wordId'] for p in c['minimalPairs'])]
        used={m['wordId'] for pair in combos for m in pair}
        for side in (0,1):
            for m in pools[side]:
                if m['wordId'] not in used:
                    combos.append((m,pools[1][0]) if side==0 else (pools[0][0],m));used.add(m['wordId'])
        for a,b in combos:
            key=s.identity([c['id'],group['id'],a['wordId'],b['wordId']])[:20]
            if key in seen:continue
            seen.add(key)
            words=[snapshot['words'][m['wordId']] for m in (a,b)]
            minimal=any(p['leftWordId']==a['wordId'] and p['rightWordId']==b['wordId'] for p in c['minimalPairs'])
            pairs.append({'id':'us-'+key,'words':[{'text':w['text'],'ipa':w['ipa'],'meaning':w.get('meaning','')} for w in words],'kind':'minimal' if minimal else 'category','abx':{'trialGroup':group['id'],'categoryByWordIndex':[0,1],'targetPosition':a['position']}})
    contrasts.append({'id':c['id'],'label':c['label'],'phonemes':[p['ipa'] for p in c['categories']],'description':c['rationale'],'pairs':pairs,'targetSoundFocus':'Listen for the target sound in each word.'})
language={'id':'en','name':'English','nativeName':'English','locale':'en-US','dialect':'General American','tagline':'Hear the small differences that change a word.','contrasts':contrasts}
(app/'src/data/us-chatterbox-curriculum.json').write_text(s.dumps(language))
assert len(contrasts)==27
print('Integrated 1000 clips and 27 US contrasts; source recordings remain unreviewed.')
