#!/usr/bin/env python3
"""Integrate a fully checked Candidate F batch locally; does not deploy hosting."""
import argparse,fcntl,json,shutil,sqlite3,time
from pathlib import Path
import studio as s
import replace_us_voice_a as batch

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--execute',action='store_true');args=ap.parse_args()
 plan=json.loads((batch.RUN/'plan.json').read_text()); results=[batch.completed(j) for j in plan['jobs']]
 assert all(results),'Batch incomplete: check summary.json and needs-review results first'
 current=json.loads(batch.PUBLIC.read_text()); receipt=batch.RUN/'promotion.json'
 if receipt.exists():
  print('Already integrated locally; verify coverage and deploy through the normal production process.');return
 assert s.sha(batch.PUBLIC.read_bytes())==plan['sourceManifestSHA256'],'Live manifest changed during generation; reconcile its latest changes before promotion'
 updated={**current,'clips':[c for c in current['clips'] if c['voiceId']!='chatterbox-us-A']}
 for job,result in zip(plan['jobs'],results):
  assert not next(a for a in result['attempts'] if a['sha256']==result['sha256'])['flags']
  fn=job['id']+'-'+result['sha256'][:12]+'.wav'
  updated['clips'].append({**job['publicTemplate'],'id':job['id'],'voiceId':'chatterbox-us-A','speakerVersion':batch.VERSION,'referenceSha256':batch.REFERENCE_SHA,'sha256':result['sha256'],'url':'/audio/chatterbox-us/'+fn,'status':'unreviewed'})
 byword={};bytext={}
 for c in updated['clips']:byword.setdefault(c['wordId'],set()).add(c['voiceId']);bytext[(c['text'],c['ipa'])]=byword[c['wordId']]
 assert len(byword)==250 and min(map(len,byword.values()))>=2,'Fewer than two distinct speakers for a word'
 curriculum=json.loads((s.ROOT/'rescue/app/src/data/us-chatterbox-curriculum.json').read_text())
 for contrast in curriculum['contrasts']:
  for pair in contrast['pairs']:
   a,b=[bytext[(w['text'],w['ipa'])] for w in pair['words']];assert a&b,'No shared A/B reference speaker'
 print(s.dumps({'newClips':len(results),'bankClips':len(updated['clips']),'words':len(byword),'minimumVoices':min(map(len,byword.values())),'sharedReferenceChecks':'passed','pronunciationStatus':'unreviewed','willPublish':False}),flush=True)
 if not args.execute:return
 with (s.STATE/'.run.lock').open('a+') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  backup=batch.RUN/'before-promotion';backup.mkdir(exist_ok=True);shutil.copy2(batch.PUBLIC,backup/'manifest.json')
  db=s.connect()
  with sqlite3.connect(backup/'audio.sqlite3') as dest:db.backup(dest)
  override=s.STATE/'us-active-reference-overrides.json'
  if override.exists():shutil.copy2(override,backup/override.name)
  reference=s.AUDIO/'fixed-reference-expansion/private/references'/('en-a-'+batch.VERSION+'.wav')
  shutil.copy2(batch.RUN/'approved-reference.wav',reference);assert s.sha(reference.read_bytes())==batch.REFERENCE_SHA
  for job,result in zip(plan['jobs'],results):
   target=s.STATE/'clips'/(job['id']+'.wav');shutil.copy2(batch.RUN/result['relativePath'],target)
   fn=job['id']+'-'+result['sha256'][:12]+'.wav';shutil.copy2(target,batch.PUBLIC.parent/fn)
   details={k:v for k,v in job.items() if k!='publicTemplate'};details.update(seed=result['seed'],technicalAudit={**s.audit(target),'qualityMetrics':result['technicalAudit']},replacement={'version':batch.VERSION,'oldVoice':'A','ownerApprovedCandidate':'F','pronunciationStatus':'unreviewed'})
   db.execute('INSERT OR IGNORE INTO clips(id,word_id,provider,voice,status,details,path,sha,review) VALUES(?,?,?,?,?,?,?,?,?)',(job['id'],job['wordId'],'chatterbox','A','complete',s.dumps(details),str(target),result['sha256'],'unreviewed'))
  oldids=[r['id'] for r in json.loads((batch.RUN/'original-a-records.json').read_text())]
  for clipid in oldids:db.execute("UPDATE clips SET status='superseded' WHERE id=? AND status='complete'",(clipid,))
  db.commit();db.close()
  batch.save(override,{'A':{'filename':reference.name,'sha256':batch.REFERENCE_SHA,'version':batch.VERSION,'approvedCandidate':'F'}})
  batch.save(batch.PUBLIC,updated)
  batch.save(receipt,{'integratedAt':time.time(),'version':batch.VERSION,'clips':len(results),'published':False,'rollbackDirectory':str(backup),'preservedOldReferences':True,'preservedRejectedRows':True})
  print('LOCAL INTEGRATION COMPLETE. Run coverage/production build checks; deploy normally. Nothing has been published by this command.')
if __name__=='__main__':main()
