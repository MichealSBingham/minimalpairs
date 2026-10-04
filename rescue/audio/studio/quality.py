#!/usr/bin/env python3
"""Offline signal triage and hash-bound, one-clip human review. Never edits audio."""
import datetime
import argparse, collections, hashlib, json, math, secrets, sqlite3, time, webbrowser
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import numpy as np
import soundfile as sf
HERE=Path(__file__).resolve().parent
PRIVATE=HERE/'private'
VERSION=1

def database():
    db=sqlite3.connect(PRIVATE/'quality.sqlite3'); db.row_factory=sqlite3.Row
    db.executescript('''CREATE TABLE IF NOT EXISTS metrics(sha TEXT,version INTEGER,data TEXT,PRIMARY KEY(sha,version));
    CREATE TABLE IF NOT EXISTS decisions(sequence INTEGER PRIMARY KEY AUTOINCREMENT,clip_id TEXT,sha TEXT,decision TEXT,created REAL);''')
    return db

def inventory():
    db=sqlite3.connect(f'file:{PRIVATE / "audio.sqlite3"}?mode=ro',uri=True); db.row_factory=sqlite3.Row
    rows=[dict(r) for r in db.execute('SELECT c.id,c.path,c.sha AS expected_sha,c.voice,c.provider,c.details AS generation_data,w.bank,w.text,w.ipa,w.word_id,w.data AS word_data FROM clips c JOIN (SELECT *,id AS word_id FROM words) w ON w.id=c.word_id WHERE c.status="complete" ORDER BY w.bank,w.text,c.voice')];db.close();return rows

def measure(path):
    x,sr=sf.read(path,always_2d=True)
    if not x.size or not np.isfinite(x).all() or sr<=0: raise ValueError('Empty or invalid audio')
    # Channel energy avoids cancelling opposite-phase stereo channels.
    mono=np.sqrt(np.mean(x*x,axis=1));size=max(1,round(sr*.02));n=len(mono)
    frames=np.array([np.sqrt(np.mean(mono[i:i+size]**2)) for i in range(0,n,size)])
    active=frames>max(.003,float(frames.max())*.08);indices=np.flatnonzero(active)
    duration=n/sr; speech=(indices[-1]-indices[0]+1)*size/sr if indices.size else 0
    gaps=[];run=0
    for v in active[indices[0]:indices[-1]+1] if indices.size else []:
        if not v:run+=1
        elif run:gaps.append(run*size/sr);run=0
    return dict(duration=duration,activeSpan=speech,rms=float(np.sqrt(np.mean(x*x))),peak=float(np.max(np.abs(x))),clippedFraction=float(np.mean(np.abs(x)>=.999)),leadingSilence=float(indices[0]*size/sr) if indices.size else duration,trailingSilence=max(0,duration-(indices[-1]+1)*size/sr) if indices.size else duration,internalGap=max(gaps,default=0),sampleRate=sr)

def absolute_flags(m):
    flags=[]
    if m['rms']<.001 or m['activeSpan']<.06:flags.append('silent_or_nearly_empty')
    if m['duration']<.15:flags.append('very_short')
    if m['duration']>4:flags.append('very_long')
    if m['clippedFraction']>.005:flags.append('sustained_clipping')
    if m['leadingSilence']>.6 or m['trailingSilence']>.8:flags.append('long_edge_silence')
    if m['internalGap']>.45:flags.append('internal_pause')
    return flags

def relative_outlier(value,peers):
    if len(peers)<3 or value<=0:return False
    median=float(np.median(peers))
    if median<=0:return False
    mad=float(np.median(np.abs(np.log(peers)-math.log(median))))
    ratio=max(value/median,median/value)
    return ratio>2 and abs(value-median)>.3 and abs(math.log(value/median))>max(.7,4*1.4826*mad)

def audit():
    db=database();rows=inventory()
    for i,row in enumerate(rows):
        try:
            payload=Path(row['path']).read_bytes();row['sha']=hashlib.sha256(payload).hexdigest()
            cached=db.execute('SELECT data FROM metrics WHERE sha=? AND version=?',(row['sha'],VERSION)).fetchone()
            metrics=json.loads(cached['data']) if cached else measure(row['path'])
            if not cached:db.execute('INSERT OR REPLACE INTO metrics VALUES(?,?,?)',(row['sha'],VERSION,json.dumps(metrics)))
            row['metrics']=metrics;row['flags']=absolute_flags(metrics)
            if row['sha']!=row['expected_sha']:row['flags'].append('changed_since_generation')
        except Exception as e:row.update(sha=row.get('sha',row['expected_sha']),metrics={},flags=['unreadable_audio'],error=type(e).__name__)
        if (i+1)%200==0:db.commit();print(f'Checked {i+1}/{len(rows)}',flush=True)
    groups=collections.defaultdict(list)
    for row in rows:
        if row['metrics'].get('activeSpan',0)>0:groups[(row['word_id'],row['provider'])].append(row['metrics']['activeSpan'])
    for row in rows:
        if relative_outlier(row['metrics'].get('activeSpan',0),groups[(row['word_id'],row['provider'])]):row['flags'].append('same_word_duration_outlier')
    for row in rows:
        row['replacement']=json.loads(row.pop('generation_data')).get('repair',{}).get('reason')=='flagged render removed; minimum voice coverage replacement'
        data=json.loads(row.pop('word_data')); row['meaning']='; '.join(data.get('meanings',[])) or data.get('meaning','')
    rows.sort(key=lambda r:(-len(r['flags']),r['bank'],r['text'],r['voice']))
    report=dict(created=time.time(),version=VERSION,clips=rows,summary=dict(clips=len(rows),flagged=sum(bool(r['flags']) for r in rows),flags=dict(collections.Counter(f for r in rows for f in r['flags'])),byBank={bank:dict(clips=sum(r['bank']==bank for r in rows),flagged=sum(r['bank']==bank and bool(r['flags']) for r in rows)) for bank in sorted({r['bank'] for r in rows})},pronunciation='Not checked by signal analysis'))
    PRIVATE.mkdir(exist_ok=True);tmp=PRIVATE/'quality-report.tmp';tmp.write_text(json.dumps(report,ensure_ascii=False));tmp.replace(PRIVATE/'quality-report.json');db.commit();db.close()
    print(json.dumps(report['summary'],indent=2),flush=True);return report

def record_decision(clip, submitted_sha, decision):
    if decision not in ('pass','reject','unreviewed') or submitted_sha!=clip['sha']:raise ValueError('Invalid decision')
    if hashlib.sha256(Path(clip['path']).read_bytes()).hexdigest()!=clip['sha']:raise ValueError('Audio changed')
    db=database()
    try:
        db.execute('INSERT INTO decisions(clip_id,sha,decision,created) VALUES(?,?,?,?)',(clip['id'],clip['sha'],decision,time.time()));db.commit()
    finally:db.close()

def serve(port):
    token=secrets.token_urlsafe(32)
    report=json.loads((PRIVATE/'quality-report.json').read_text());clips={r['id']:r for r in report['clips']}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def send(self,code,data,content='application/json'):
            self.send_response(code);self.send_header('Content-Type',content);self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(data)
        def do_GET(self):
            if self.headers.get('Host')!=f'127.0.0.1:{port}':return self.send(403,b'{}')
            path=urlparse(self.path).path
            if path=='/':return self.send(200,(HERE/'quality.html').read_text().replace('__TOKEN__',token).encode(),'text/html; charset=utf-8')
            if path=='/api/queue':
                fresh=json.loads((PRIVATE/'quality-report.json').read_text());clips.clear();clips.update({r['id']:r for r in fresh['clips']})
                layer=json.loads((PRIVATE/'layer2-report.json').read_text()) if (PRIVATE/'layer2-report.json').exists() else {}
                second={(r['id'],r['sha']):r for r in layer.get('clips',[])}
                next_rows=json.loads((PRIVATE/'next-review.json').read_text()) if (PRIVATE/'next-review.json').exists() else []
                next_ids={(r['id'],r['sha']) for r in next_rows}
                sample_path=PRIVATE/'launch-sample.json'
                sample_ids={(r['id'],r['sha']) for r in json.loads(sample_path.read_text())} if sample_path.exists() else set()
                customer=json.loads((PRIVATE/'customer-reports.json').read_text()).get('reports',[]) if (PRIVATE/'customer-reports.json').exists() else []
                next_ids.update((r['clipId'],r['sha256']) for r in customer)
                customer_times={(r['clipId'],r['sha256']):max(datetime.datetime.fromisoformat(x['lastSeen']).timestamp() for x in customer if x['clipId']==r['clipId'] and x['sha256']==r['sha256']) for r in customer}
                db=database();decisions={}
                for r in db.execute('SELECT * FROM decisions ORDER BY sequence'):decisions[(r['clip_id'],r['sha'])]=dict(r)
                db.close();items=[{**{k:v for k,v in c.items() if k not in ('path','expected_sha')},'review':decisions.get((c['id'],c['sha']),{}).get('decision','unreviewed')} for c in clips.values()]
                for item in items:
                    item['launchSample']=(item['id'],item['sha']) in sample_ids
                    item['nextReview']=(item['id'],item['sha']) in next_ids
                    if customer_times.get((item['id'],item['sha']),0)>decisions.get((item['id'],item['sha']),{}).get('created',0):item['review']='unreviewed'
                    audit=second.get((item['id'],item['sha']))
                    if audit:
                        item['layer2']=audit;item['flags']=list(dict.fromkeys(item['flags']+audit['flags']))
                items.sort(key=lambda r:(-len(r['flags']),r['bank'],r['text']))
                return self.send(200,json.dumps({'clips':items,'summary':fresh['summary'],'layer2':{k:v for k,v in layer.items() if k!='clips'}},ensure_ascii=False).encode())
            if path.startswith('/audio/'):
                c=clips.get(path.removeprefix('/audio/'))
                if not c:return self.send(404,b'{}')
                try:data=Path(c['path']).read_bytes()
                except OSError:return self.send(404,b'{}')
                if hashlib.sha256(data).hexdigest()!=c['sha']:return self.send(409,b'{}')
                return self.send(200,data,'audio/wav')
            self.send(404,b'{}')
        def do_POST(self):
            origin=f'http://127.0.0.1:{port}'
            if self.headers.get('Host')!=f'127.0.0.1:{port}' or self.headers.get('Origin')!=origin or self.headers.get('X-QA-Token')!=token:return self.send(403,b'{}')
            if self.path!='/api/decision':return self.send(404,b'{}')
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<2048:raise ValueError()
                data=json.loads(self.rfile.read(length));c=clips[data['id']]
                if data['sha']!=c['sha'] or data['decision'] not in ('pass','reject','unreviewed'):raise ValueError()
                if hashlib.sha256(Path(c['path']).read_bytes()).hexdigest()!=c['sha']:return self.send(409,b'{"error":"Audio changed. Run the scan again."}')
                record_decision(c,data['sha'],data['decision']);self.send(200,b'{"saved":true}')
            except (KeyError,ValueError,OSError):self.send(400,b'{"error":"Could not save this decision."}')
    print(f'Review: http://127.0.0.1:{port}',flush=True)
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler);webbrowser.open(f'http://127.0.0.1:{port}');server.serve_forever()
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['scan','review']);p.add_argument('--port',type=int,default=63120);args=p.parse_args()
    if args.command=='scan':audit()
    else:
        if not (PRIVATE/'quality-report.json').exists():audit()
        serve(args.port)
