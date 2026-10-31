import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const studio=path.resolve('../audio/studio/private');
const rows=JSON.parse(execFileSync('python3',['-c',`import sqlite3,json
c=sqlite3.connect(${JSON.stringify(path.join(studio,'quality.sqlite3'))})
c.row_factory=sqlite3.Row
print(json.dumps([dict(x) for x in c.execute('SELECT clip_id,sha,decision,created FROM decisions ORDER BY sequence')]))`],{encoding:'utf8'}));
const decisions=new Map(rows.map(r=>[r.clip_id+'_'+r.sha,r.decision]));
const triage=JSON.parse(fs.readFileSync(path.join(studio,'triage-review.json'),'utf8')).clips||[];
const triageByKey=new Map(triage.map(r=>[r.id+'_'+r.sha,r]));
const signals=new Map(JSON.parse(fs.readFileSync(path.join(studio,'quality-report.json'),'utf8')).clips.map(r=>[r.id+'_'+r.sha,r]));
const audits=new Map(JSON.parse(fs.readFileSync(path.join(studio,'layer2-report.json'),'utf8')).clips.map(r=>[r.id+'_'+r.sha,r]));
function risk(c){const k=c.id+'_'+c.sha256,t=triageByKey.get(k),q=signals.get(k),a=audits.get(k);if(t)return {risk:t.priority,reason:t.reason};if(!q||!a)return {risk:'needs_audit',reason:'Machine audit incomplete'};const flags=[...(q.flags||[]),...(a.flags||[])];return flags.length?{risk:'high',reason:'Machine flags'}:{risk:'sample',reason:'No machine flags'};}

const clips=[];for(const bank of ['us','fr','es','de','it','pt','ru','zh','ja']){const m=JSON.parse(fs.readFileSync(`public/audio/chatterbox-${bank}/manifest.json`,'utf8'));for(const c of m.clips){if(!c.id||!c.sha256||!c.url?.startsWith('/audio/'))throw Error('Invalid review manifest');clips.push({id:c.id,sha256:c.sha256,bankId:c.bankId,text:c.text,ipa:c.ipa,voiceId:c.voiceId,url:c.url,baseline:decisions.get(c.id+'_'+c.sha256)||'unreviewed',...risk(c),priority:['high','needs_audit'].includes(risk(c).risk),contrasts:[...new Set((c.memberships||[]).map(x=>x.contrastId))]});}}
const stagedPath='public/audio/owner-review-staged.json';
if(fs.existsSync(stagedPath))for(const c of JSON.parse(fs.readFileSync(stagedPath,'utf8')).clips){if(!c.staged||!c.url.startsWith('/audio/owner-review-staged/')||!fs.existsSync('public'+c.url))throw Error('Invalid staged review clip');if(!clips.some(p=>p.id===c.id&&p.sha256===c.sha256))clips.push({...c,baseline:decisions.get(c.id+'_'+c.sha256)||'unreviewed'});}
fs.writeFileSync('public/audio/owner-review-catalog.json',JSON.stringify({generatedAt:new Date().toISOString(),clips}));console.log(`Prepared ${clips.length} production audio review entries`);
