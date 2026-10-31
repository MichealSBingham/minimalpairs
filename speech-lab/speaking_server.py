"""Local speaking workbench. Audio stays in memory; loopback interface only."""
import argparse
import hashlib
import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from pathlib import Path

from speaking_engine import SpeakingEngine, decode_recording

ROOT=Path(__file__).resolve().parent
PUBLIC=ROOT.parent/'rescue/app/public'
ASSETS=ROOT/'speaking'
MODEL=None
LOCK=threading.Lock()
EXAMPLES={}


def references():
    manifest=json.loads((PUBLIC/'audio/human-en-i-ih/manifest.json').read_text())
    rows={}
    for c in manifest['clips']:
        if c['text'] not in ('ship','sheep'):continue
        path=PUBLIC/c['url'].lstrip('/')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=c['sha256']:
            raise RuntimeError('Reference integrity check failed.')
        rows[c['id']]={'id':c['id'],'word':c['text'],'speaker':c['speaker'],
            'voice_id':c['voiceId'],'source':c['sourcePage'],'license':c['license'],
            'changes':c['changes'],'path':path}
    return rows


REFS=references()


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup();self.connection.settimeout(10)
    def log_message(self,*args):pass
    def permitted(self):
        hosts=[f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}']
        return (self.headers.get('Host') in hosts and
                self.headers.get('Origin') in (None,*['http://'+h for h in hosts]))
    def send(self,data,status=200,ctype='application/json'):
        if not isinstance(data,bytes):data=json.dumps(data,allow_nan=False,ensure_ascii=False).encode()
        self.send_response(status)
        for name,value in {'Content-Type':ctype,'Content-Length':str(len(data)),
            'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
            'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
            'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'"}.items():
            self.send_header(name,value)
        self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_GET(self):
        if not self.permitted():return self.send({'error':'Local requests only.'},403)
        u=urlparse(self.path);q=parse_qs(u.query)
        if u.path=='/api/config':
            return self.send({'status':'ready','max_seconds':6,'lead_in_ms':600,
                'references':[{k:v for k,v in r.items() if k!='path'} for r in REFS.values()]})
        if u.path=='/api/reference':
            ref=REFS.get(q.get('id',[''])[0])
            if not ref:return self.send({'error':'Unknown example.'},404)
            return self.send(ref['path'].read_bytes(),ctype='audio/mpeg')
        paths={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/capture.js':'capture.js',**{('/'+name):name for name in ('live.js','live-worker.js','live-analysis.mjs','live-baseline.mjs','live-quality.mjs')}}
        if u.path not in paths:return self.send({'error':'Not found.'},404)
        path=ASSETS/paths[u.path]
        return self.send(path.read_bytes(),ctype=mimetypes.guess_type(path)[0] or 'text/plain')
    def do_POST(self):
        if not self.permitted():return self.send({'error':'Local requests only.'},403)
        if not LOCK.acquire(blocking=False):return self.send({'error':'Another recording is being measured. Try again shortly.'},429)
        try:
            u=urlparse(self.path);q=parse_qs(u.query)
            if u.path=='/api/example':
                key=q.get('id',[''])[0];ref=REFS.get(key)
                if not ref:return self.send({'error':'Unknown example.'},404)
                if key not in EXAMPLES:
                    x,sr=decode_recording(ref['path'].read_bytes())
                    EXAMPLES[key]={**MODEL.analyze(x),'input_sample_rate':sr}
                return self.send(EXAMPLES[key])
            if u.path!='/api/measure':return self.send({'error':'Not found.'},404)
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=2500000:raise ValueError('Choose a recording under 2.5 MB.')
            body=self.rfile.read(length)
            if len(body)!=length:raise ValueError('The recording upload was incomplete.')
            x,sr=decode_recording(body)
            result=MODEL.analyze(x,int(q.get('lead_in_ms',['0'])[0]))
            return self.send({**result,'input_sample_rate':sr})
        except (ValueError,TimeoutError) as e:return self.send({'error':str(e)},400)
        except Exception:
            return self.send({'error':'The local analysis failed. Try another short recording.'},500)
        finally:LOCK.release()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8767);args=p.parse_args()
    print('Loading the vowel measurement model…',flush=True);MODEL=SpeakingEngine()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Speaking workbench ready: http://127.0.0.1:{args.port}',flush=True)
    server.serve_forever()
