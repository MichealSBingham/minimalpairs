import json,shutil
import studio as s
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--bank',required=True,choices=['fr','de','es','it','zh','pt','ru','ja']);args=parser.parse_args()
bank_id=args.bank
db=s.connect();clips=[]
for row in db.execute("SELECT c.*,w.data FROM clips c JOIN words w ON c.word_id=w.id WHERE w.bank=? AND c.provider='chatterbox' AND c.status='complete'",(bank_id,)):
    word=json.loads(row['data']);details=json.loads(row['details'])
    clips.append({'clipId':row['id'],'wordId':row['word_id'],'text':word['text'],'ipa':word['ipa'],'voiceId':row['voice'],'sha256':row['sha'],'relativeAudioPath':'clips/'+s.Path(row['path']).name,'memberships':word['memberships'],'audioFlags':details.get('technicalAudit',{}).get('flags',[])})
expected=db.execute('SELECT count(*) FROM words WHERE bank=?',(bank_id,)).fetchone()[0]*4
if len(clips)!=expected:raise ValueError(f'Incomplete bank {bank_id}: {len(clips)}/{expected}')
bank={'collectionId':f'chatterbox-{bank_id}-four-voices-v1','voices':['A','B','C','D'],'clips':clips}

app=s.ROOT/'rescue/app'; out=app/f'public/audio/chatterbox-{bank_id}';out.mkdir(exist_ok=True)
manifest={'collectionId':bank['collectionId'],'voicesByLanguage':{bank_id:[{'id':'chatterbox-'+bank_id+'-'+v,'name':'Voice '+v,'source':'synthetic-fixed-reference'} for v in bank['voices']]},'clips':[]}
for clip in bank['clips']:
    source=s.STATE/clip['relativeAudioPath'];assert s.sha(source.read_bytes())==clip['sha256']
    filename=clip['clipId']+'-'+clip['sha256'][:12]+'.wav';shutil.copy2(source,out/filename)
    manifest['clips'].append({'id':clip['clipId'],'wordId':clip['wordId'],'languageId':bank_id,'bankId':bank_id,'text':clip['text'],'ipa':clip['ipa'],'voiceId':'chatterbox-'+bank_id+'-'+clip['voiceId'],'url':'/audio/chatterbox-'+bank_id+'/'+filename,'sha256':clip['sha256'],'status':'unreviewed','synthetic':True,'provider':'chatterbox','memberships':clip['memberships'],'audioFlags':clip['audioFlags']})
(out/'manifest.json').write_text(s.dumps(manifest))
snapshot=json.loads(s.SNAPSHOT.read_text());contrasts=[]
for c in snapshot['contrasts']:
    if c['languageId']!=bank_id:continue
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
            pairs.append({'id':bank_id+'-'+key,'words':[{'text':w['text'],'ipa':w['ipa'],'meaning':w.get('meaning','')} for w in words],'kind':'minimal' if minimal else 'category','abx':{'trialGroup':group['id'],'categoryByWordIndex':[0,1],'targetPosition':a['position']}})
    contrasts.append({'id':c['id'],'label':c['label'],'phonemes':[p['ipa'] for p in c['categories']],'description':c['rationale'],'pairs':pairs,'targetSoundFocus':'Listen for the target sound in each word.'})
names={'fr':('French','Français'),'de':('German','Deutsch'),'es':('Spanish','Español'),'it':('Italian','Italiano'),'zh':('Mandarin','中文'),'pt':('Portuguese','Português'),'ru':('Russian','Русский'),'ja':('Japanese','日本語')}
reference=next(b['reference'] for b in snapshot['banks'] if b['id']==bank_id)
language={'id':bank_id,'name':names[bank_id][0],'nativeName':names[bank_id][1],'locale':s.LOCALES[bank_id],'dialect':reference,'tagline':'Hear the small differences that change a word.','contrasts':contrasts}
(app/f'src/data/{bank_id}-chatterbox-curriculum.json').write_text(s.dumps(language))
print(f'Prepared {bank_id}: {len(clips)} recordings and {len(contrasts)} contrasts; unreviewed with flags preserved.')
