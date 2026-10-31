"""Loopback-only research prototype. Audio is analyzed in memory, never saved."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlparse,parse_qs
from pathlib import Path
import argparse,json,threading,mimetypes
from engine import Engine,ROOT,PAIRS,decode_audio,acoustic_analysis
from evaluate import references

MODEL=None
LOCK=threading.Lock()
REFS={r['id']:r for r in references()}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def valid_host(self):
        return self.headers.get('Host') in [f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}']
    def send(self,data,ctype='application/json',status=200):
        if not isinstance(data,bytes):data=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status);self.send_header('Content-Type',ctype)
        self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer')
        self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if not self.valid_host():return self.send({'error':'Invalid host'},status=403)
        u=urlparse(self.path);q=parse_qs(u.query)
        if u.path=='/api/config':
            return self.send({'pairs':PAIRS,'references':[{k:v for k,v in r.items() if k!='path'} for r in REFS.values()]})
        if u.path=='/api/results':
            f=ROOT/'artifacts/summary.json'
            return self.send(json.loads(f.read_text()) if f.exists() else {'status':'Evaluation in progress'})
        if u.path=='/api/reference':
            ref=REFS.get(q.get('id',[''])[0])
            if ref:return self.send(Path(ref['path']).read_bytes(),'audio/mpeg')
            return self.send({'error':'Unknown recording'},status=404)
        files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/record-worklet.js':'record-worklet.js'}
        if u.path in files:
            path=ROOT/'static'/files[u.path]
        elif u.path in ['/dsp.mjs','/analysis-worker.js']:
            path=ROOT.parent/'vowel-map/public'/u.path.lstrip('/')
        else:return self.send({'error':'Not found'},status=404)
        return self.send(path.read_bytes(), 'text/javascript' if path.suffix in ['.js','.mjs'] else mimetypes.guess_type(path)[0] or 'text/plain')
    def do_POST(self):
        if not self.valid_host():return self.send({'error':'Invalid host'},status=403)
        origin=self.headers.get('Origin')
        if origin and origin not in [f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}']:
            return self.send({'error':'Local requests only'},status=403)
        if not LOCK.acquire(blocking=False):return self.send({'error':'An analysis is already running. Try again shortly.'},status=429)
        try:
            u=urlparse(self.path);q=parse_qs(u.query)
            if u.path=='/api/demo':
                ref=REFS.get(q.get('id',[''])[0])
                if not ref:raise ValueError('Unknown reference recording.')
                audio=decode_audio(ref['path'])
            elif u.path in ['/api/analyze','/api/acoustics']:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=5000000:raise ValueError('Audio upload must be under 5 MB.')
                audio=decode_audio(self.rfile.read(length))
            else:return self.send({'error':'Not found'},status=404)
            result=acoustic_analysis(audio) if u.path=='/api/acoustics' or q.get('mode')==['acoustic'] else MODEL.analyze(audio,q.get('pair',['tout-tu'])[0],int(q.get('target',['0'])[0]))
            return self.send(result)
        except (ValueError,RuntimeError) as e:return self.send({'error':str(e)},status=400)
        except Exception:return self.send({'error':'Analysis failed. Please retry a short WAV recording.'},status=500)
        finally:LOCK.release()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8766);args=p.parse_args()
    print('Loading local model...',flush=True);MODEL=Engine()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Ready: http://127.0.0.1:{args.port}',flush=True)
    server.serve_forever()
