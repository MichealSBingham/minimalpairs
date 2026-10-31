// Pull owner cloud decisions into the established local cleanup pipeline. No audio changes.
import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);const auth=require('firebase-tools/lib/auth.js');const account=auth.getGlobalDefaultAccount();if(!account)throw Error('Firebase CLI sign-in required');const token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
let next='',rows=[];do{const u=new URL('https://firestore.googleapis.com/v1/projects/minimalpairs/databases/(default)/documents/ownerAudioReviews');u.searchParams.set('pageSize','300');if(next)u.searchParams.set('pageToken',next);const r=await fetch(u,{headers:{Authorization:'Bearer '+token.access_token}});if(!r.ok)throw Error('Cloud review read failed: '+r.status);const j=await r.json();for(const d of j.documents||[]){const f=d.fields;const row={id:f.clipId?.stringValue,sha:f.sha256?.stringValue,decision:f.decision?.stringValue,created:Date.parse(f.updatedAt?.timestampValue)/1000};if(!/^[a-f0-9]{64}$/.test(row.id)||!/^[a-f0-9]{64}$/.test(row.sha)||!['pass','reject','unreviewed'].includes(row.decision)||!Number.isFinite(row.created))throw Error('Invalid saved review');rows.push(row);}next=j.nextPageToken||'';}while(next);
const db=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../audio/studio/private/quality.sqlite3');
const result=execFileSync('python3',['-c',`import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1]);n=0
rows=json.load(sys.stdin)
for r in rows:
 old=c.execute('SELECT decision,created FROM decisions WHERE clip_id=? AND sha=? ORDER BY sequence DESC LIMIT 1',(r['id'],r['sha'])).fetchone()
 if not old or (r['created']>old[1] and r['decision']!=old[0]):
  c.execute('INSERT INTO decisions(clip_id,sha,decision,created) VALUES(?,?,?,?)',(r['id'],r['sha'],r['decision'],r['created']));n+=1
c.commit();c.close();print(json.dumps({'cloudReviews':len(rows),'imported':n}))`,db],{input:JSON.stringify(rows),encoding:'utf8'});console.log(result.trim());
