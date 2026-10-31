"""Promote only exact-hash owner-approved October 31 replacements; retain backups."""
import json,sqlite3,hashlib,shutil,datetime
from pathlib import Path
root=Path(__file__).resolve().parents[3];state=root/'rescue/audio/studio/private';public=root/'rescue/app/public';mp=public/'audio/chatterbox-us/manifest.json'
q=sqlite3.connect(state/'quality.sqlite3');a=sqlite3.connect(state/'audio.sqlite3');a.row_factory=sqlite3.Row
manifest=json.loads(mp.read_text());staged=json.loads((public/'audio/owner-review-staged.json').read_text());approved=[]
for clip in staged['clips']:
 decision=q.execute('SELECT decision FROM decisions WHERE clip_id=? AND sha=? ORDER BY sequence DESC LIMIT 1',(clip['id'],clip['sha256'])).fetchone()
 if not decision or decision[0]!='pass':continue
 source=public/clip['url'].lstrip('/');assert hashlib.sha256(source.read_bytes()).hexdigest()==clip['sha256']
 record=state/'coverage-replacements-2026-10-31'/(clip['id']+'.json');r=json.loads(record.read_text());assert any(x['sha256']==clip['sha256'] and not x['flags'] for x in r['attempts'])
 approved.append((clip,source,record,r))
backup=state/'coverage-promotion-2026-10-31';backup.mkdir(exist_ok=True)
if not (backup/'manifest-before.json').exists():shutil.copy2(mp,backup/'manifest-before.json');a.backup(sqlite3.connect(backup/'audio-before.sqlite3'))
for c,source,record,r in approved:
 dest=public/'audio/chatterbox-us'/source.name;shutil.copy2(source,dest)
 entry={**r['job']['publicTemplate'],'id':c['id'],'sha256':c['sha256'],'url':'/audio/chatterbox-us/'+dest.name,'voiceId':c['voiceId'],'status':'approved','speakerVersion':r['job']['voice']['speakerVersion'],'referenceSha256':r['job']['voice']['referenceSha256']}
 manifest['clips']=[x for x in manifest['clips'] if x['id']!=c['id']]+[entry]
 voices={x['voiceId'] for x in manifest['clips'] if x['wordId']==entry['wordId']};assert len(voices)>=2
 manifest['practiceExclusions']=[x for x in manifest['practiceExclusions'] if not(x['text']==c['text'] and x['ipa']==c['ipa'])]
 old=a.execute('SELECT * FROM clips WHERE id=?',(c['id'],)).fetchone();assert old
 a.execute('UPDATE clips SET path=?,sha=?,status=?,review=? WHERE id=?',(str(dest),c['sha256'],'complete','pass',c['id']))
 r.update(humanApproved=True,status='approved-pending-deployment');record.write_text(json.dumps(r,indent=2)+'\n')
a.commit();mp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
remaining=[c for c in staged['clips'] if c['id'] not in {x[0]['id'] for x in approved}];(public/'audio/owner-review-staged.json').write_text(json.dumps({'clips':remaining},ensure_ascii=False)+'\n')
print(json.dumps({'promotedToBuild':[x[0]['text'] for x in approved],'stillExcluded':manifest['practiceExclusions']}))
