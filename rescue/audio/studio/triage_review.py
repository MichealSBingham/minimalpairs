#!/usr/bin/env python3
"""Rank production audio review locally. Never changes flags, approvals, audio, or manifests."""
import collections, datetime, hashlib, json, re, sqlite3
from pathlib import Path
HERE=Path(__file__).resolve().parent
# Deliberately narrow, General American single-token sound-equivalent spellings.
ALIASES={'bee':{'b','be'},'disk':{'disc'},'heel':{'heal'},'lane':{'lain'},'mat':{'matt'},'pea':{'p'},'seem':{'seam'},'seize':{'seas'},'sell':{'cell'},'shoe':{'shoo'},'sink':{'sync'},'steel':{'steal'},'sum':{'some'},'three':{'3'},'write':{'right'},'ton':{'tonne'}}
def token(s):
    # Only boundary punctuation; preserve separators, repeats, apostrophes, and spaces.
    return s.casefold().strip().strip('.,!?;:').strip()
def classify(clip, audit, current_sha, reported=False):
    original=list(dict.fromkeys(clip.get('flags',[])+audit.get('flags',[])))
    if current_sha!=clip['sha'] or not audit or audit.get('sha')!=current_sha:
        return 'needs_audit','Missing or stale audit',original
    if reported:return 'high','User reported',original
    if clip.get('flags') or any(f not in ('asr_text_mismatch','asr_low_confidence') for f in original):
        return 'high','Signal, missing speech, or repetition flag',original
    expected,heard=token(clip['text']),token(audit.get('transcript',''))
    if original and clip['bank']=='en-US-ga' and re.fullmatch('[a-z0-9]+',heard or '') and heard in ALIASES.get(expected,set()):
        return 'lower','Sound-equivalent transcript spelling; pronunciation unverified',original
    if set(original)=={'asr_low_confidence'} and expected==heard:
        return 'lower','Expected transcript with low confidence',original
    if original:return 'high','Transcript disagreement',original
    return 'sample','No automated flags; pronunciation unverified',original

def run():
    p=HERE/'private'; app=HERE.parents[1]/'app'; quality=json.loads((p/'quality-report.json').read_text()); audits={(r['id'],r['sha']):r for r in json.loads((p/'layer2-report.json').read_text())['clips']};local={(r['id'],r['sha']):r for r in quality['clips']}
    db=sqlite3.connect(f'file:{p}/quality.sqlite3?mode=ro',uri=True)
    decisions={(a,b):(s,t) for a,b,s,t in db.execute('select clip_id,sha,decision,created from decisions order by sequence')};db.close()
    reports={}
    for r in json.loads((p/'customer-reports.json').read_text()).get('reports',[]):
        k=r['clipId'],r['sha256'];reports[k]=max(reports.get(k,0),datetime.datetime.fromisoformat(r['lastSeen']).timestamp())
    queue=[];counts=collections.defaultdict(collections.Counter)
    for path in sorted((app/'public/audio').glob('chatterbox-*/manifest.json')):
        for m in json.loads(path.read_text())['clips']:
            k=m['id'],m['sha256'];c=local.get(k);decision,when=decisions.get(k,('unreviewed',0));reported=reports.get(k,0)>when
            if decision!='unreviewed' and not reported:continue
            if c:
                audio=Path(c['path']);actual=hashlib.sha256(audio.read_bytes()).hexdigest() if audio.exists() else None
                priority,reason,flags=classify(c,audits.get(k,{}),actual,reported)
            else:priority,reason,flags='needs_audit','Missing current signal audit',[]
            bank=c['bank'] if c else m['bankId'];counts[bank][priority]+=1
            queue.append(dict(id=m['id'],sha=m['sha256'],bank=bank,word=m['text'],ipa=m['ipa'],voice=m['voiceId'],priority=priority,reason=reason,originalFlags=flags))
    rank={'needs_audit':0,'high':1,'lower':2,'sample':3};queue.sort(key=lambda r:(rank[r['priority']],r['bank'],r['word'],r['voice']))
    out={'version':1,'created':datetime.datetime.now(datetime.timezone.utc).isoformat(),'note':'Priority only; never approval. Original flags and decisions unchanged.','byBank':dict(counts),'clips':queue}
    dest=p/'triage-review.json';tmp=dest.with_suffix('.tmp');tmp.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');tmp.replace(dest)
    print(json.dumps({'queue':str(dest),'byBank':dict(counts)},indent=2));return out
if __name__=='__main__':run()
