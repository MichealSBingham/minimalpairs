#!/usr/bin/env python3
"""Local, resumable audition database. No API calls without generate/catalog."""
import argparse, base64, collections, fcntl, hashlib, html, importlib.util, json, os, re, sqlite3, sys, time, urllib.parse, urllib.request
from pathlib import Path
HERE=Path(__file__).resolve().parent
AUDIO=HERE.parent
ROOT=AUDIO.parent.parent
STATE=HERE/'private'
SNAPSHOT=ROOT/'rescue/content/phoneme-research/releases/text-bank-v2.json'
LOCALES={'en-US-ga':'en-US','en-GB-ssbe':'en-GB','fr':'fr-FR','de':'de-DE','es':'es-MX','it':'it-IT','zh':'cmn-CN','pt':'pt-BR','ru':'ru-RU','ja':'ja-JP'}
CARTESIA_LOCALES={**LOCALES,'zh':'zh-CN'}
TRIAL='ship sheep sit seat thin sin right light cat cut cap cup look luck book buck'.split()
MODEL_REV='03565773edd72e949572557597af8063bb49a18a'
TOKENIZER_REV='e0c9886f0e1c35ae85b1f27277416fb19fc72bec'
REFS={'A':('en-a-seed-928000.wav','5758a766ae5788c5c77d7dbefd3c6867eb55de61c308d4cdc5fd53b26362fe22'),'B':('en-b-seed-928010.wav','fc29c14cc88bbb38b476ae33ea860498efff6fb98a4e5d3bc95f23878a447eb1')}
EXTRA_VOICES=STATE/'extra-voices.json'
if EXTRA_VOICES.exists():
    for entry in json.loads(EXTRA_VOICES.read_text()):
        if entry['label'] not in ('C','D'): raise ValueError('Unexpected extra voice label')
        REFS[entry['label']]=(entry['filename'],entry['sha256'])
SETTINGS=dict(lang_code='en',exaggeration=0.1,cfg_weight=0.5,temperature=0.8,repetition_penalty=1.2,min_p=0.05,top_p=1.0,max_new_tokens=128,verbose=False,stream=False)
def sha(b): return hashlib.sha256(b).hexdigest()
def dumps(v): return json.dumps(v,ensure_ascii=False,sort_keys=True)
def identity(v): return sha(dumps(v).encode())
def norm(s): return s.strip().lower()
def ipa(s): return re.sub(r'[\[\]/\sˈˌ.]','',s)
def connect():
    STATE.mkdir(exist_ok=True,mode=0o700)
    db=sqlite3.connect(STATE/'audio.sqlite3'); db.row_factory=sqlite3.Row
    db.executescript('''CREATE TABLE IF NOT EXISTS words(id TEXT PRIMARY KEY,bank TEXT,text TEXT,ipa TEXT,data TEXT,flags TEXT);
    CREATE TABLE IF NOT EXISTS clips(id TEXT PRIMARY KEY,word_id TEXT,provider TEXT,voice TEXT,status TEXT,details TEXT,path TEXT,sha TEXT,review TEXT DEFAULT 'unreviewed');
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);''')
    return db

def init(db):
    source=json.loads(SNAPSHOT.read_text()); units={}
    reserved=json.loads((ROOT/'rescue/content/transfer-candidates.json').read_text())
    held=[]
    for group in reserved['sets']:
        held.extend((group['languageId'],norm(w['text']),ipa(w['ipa'])) for p in group['pairs'] for w in p['words'])
    held.extend(('zh',norm(w['text']),ipa(w['ipa'])) for w in source['mandarinBalance']['lexicalItems'] if w['split']=='heldout')
    for c in source['contrasts']:
        bank=c.get('varietyId') or c['languageId']
        for side,pool in enumerate(c['pools']):
            for member in pool:
                w=source['words'][member['wordId']]
                if any(lang==w['languageId'] and (text==norm(w['text']) or sound==ipa(w['ipa'])) for lang,text,sound in held):
                    raise ValueError('Reserved assessment collision: '+w['text'])
                key=identity([bank,w['text'],w['ipa'],w.get('reading')])
                entry=units.setdefault(key,{**w,'id':key,'bankId':bank,'memberships':[],'meanings':[],'sourceWordIds':[]})
                entry['memberships'].append({'contrastId':c['id'],'category':side,'phoneme':c['categories'][side]['ipa']})
                if w.get('meaning') not in entry['meanings']: entry['meanings'].append(w.get('meaning'))
                if w['id'] not in entry['sourceWordIds']: entry['sourceWordIds'].append(w['id'])
    dictionary=collections.defaultdict(set); reverse=collections.defaultdict(set)
    for line in (HERE/'sources/cmudict.dict').read_text().splitlines():
        pieces=line.split(' #')[0].split()
        if len(pieces)<2: continue
        word=re.sub(r'\(\d+\)$','',pieces[0]); pronunciation=' '.join(pieces[1:])
        dictionary[word].add(pronunciation); reverse[pronunciation].add(word)
    sounds=collections.defaultdict(set); spellings=collections.defaultdict(set)
    for w in units.values():
        sounds[(w['bankId'],ipa(w['ipa']))].add(w['text']); spellings[(w['bankId'],norm(w['text']))].add(w['ipa'])
    for key,w in units.items():
        flags=[]; same=sounds[(w['bankId'],ipa(w['ipa']))]-{w['text']}
        if same: flags.append({'type':'bank_homophones','words':sorted(same)})
        variants=spellings[(w['bankId'],norm(w['text']))]
        if len(variants)>1: flags.append({'type':'bank_multiple_pronunciations','ipa':sorted(variants)})
        if w['languageId']=='en':
            pronunciations=dictionary[norm(w['text'])]
            if len(pronunciations)>1: flags.append({'type':'cmu_multiple_readings_or_variants','arpabet':sorted(pronunciations),'note':'US dictionary screening; includes optional variants. Check intended IPA and meaning, especially for British English.'})
            alternatives=set().union(*(reverse[p] for p in pronunciations))-{norm(w['text'])} if pronunciations else set()
            if alternatives: flags.append({'type':'cmu_possible_homophones','words':sorted(alternatives),'note':'Any dictionary reading may match; names and rare words can appear. Not all match intended IPA.'})
            if not pronunciations: flags.append({'type':'not_in_cmu_dictionary'})
        else: flags.append({'type':'external_pronunciation_screen_pending','note':'Only within-bank checks performed; language-specific external screening remains.'})
        db.execute('INSERT OR REPLACE INTO words VALUES(?,?,?,?,?,?)',(key,w['bankId'],w['text'],w['ipa'],dumps(w),dumps(flags)))
    db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)',('snapshot_sha256',sha(SNAPSHOT.read_bytes())));db.commit()
    print(dumps({'recordingUnits':len(units),'byBank':dict(collections.Counter(w['bankId'] for w in units.values()))}))

def google_module():
    spec=importlib.util.spec_from_file_location('google_audition',AUDIO/'google-chirp-audition/audition.py'); mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

def cartesia_request(endpoint,payload=None):
    key=os.getenv('CARTESIA_API_KEY')
    if not key: raise ValueError('Cartesia key is not configured. Use the launcher to save it privately on this Mac.')
    req=urllib.request.Request('https://api.cartesia.ai/'+endpoint,data=dumps(payload).encode() if payload else None,headers={'Authorization':'Bearer '+key,'Cartesia-Version':'2026-08-14','Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=90) as response:
            data=response.read(8_000_001)
            if len(data)>8_000_000: raise ValueError('Audio response exceeds size ceiling')
            return data
    except Exception as e:
        raise RuntimeError('Cartesia request failed; HTTP '+str(getattr(e,'code','unavailable'))+'. No automatic retry.') from None

def bank_refs(bank):
    if bank=='en-US-ga':
        refs=dict(REFS)
        override=STATE/'us-active-reference-overrides.json'
        if override.exists():
            for label,value in json.loads(override.read_text()).items():
                if label not in refs:raise ValueError('Unknown replacement speaker slot')
                refs[label]=(value['filename'],value['sha256'])
        return refs
    path=STATE/(bank+'-references.json')
    if not path.exists():raise ValueError('No auditioned reference profiles configured for '+bank)
    return {v['label']:(v['filename'],v['sha256']) for v in json.loads(path.read_text())}

def catalog(provider,bank):
    if provider=='google':
        g=google_module(); allvoices=g.GoogleTransport(g.AUTHORIZED_PROJECT).catalog()['voices'];locale=LOCALES[bank]
        voices=[{'id':v['name'],'name':v['name'],'gender':v.get('ssmlGender'),'locale':locale} for v in allvoices if locale in v.get('languageCodes',[]) and '-Chirp3-HD-' in v['name']]
    elif provider=='cartesia':
        locale=CARTESIA_LOCALES[bank]; allvoices=[];cursor=None
        for _ in range(30):
            params={'language':locale,'limit':100}
            if cursor: params['starting_after']=cursor
            page=json.loads(cartesia_request('voices?'+urllib.parse.urlencode(params)));batch=page.get('data',[]);allvoices+=batch
            if not page.get('has_more'): break
            if not batch or batch[-1]['id']==cursor: raise ValueError('Invalid catalog pagination')
            cursor=batch[-1]['id']
        else: raise ValueError('Catalog pagination limit reached')
        voices=[{'id':v['id'],'name':v['name'],'gender':v.get('gender'),'locale':locale,'accents':v['accents']} for v in allvoices if v.get('status')=='active' and any(a.get('locale')==locale and a.get('is_native') is True for a in v.get('accents',[]))]
    else:
        voices=[{'id':label,'name':'Chatterbox '+label,'locale':LOCALES[bank],'referenceSha256':value[1],'accentVerified':False} for label,value in bank_refs(bank).items()]
    (STATE/f'{provider}-{bank}-voices.json').write_text(dumps(voices))
    return voices

def pick_voices(voices,n):
    # Alternate catalog gender labels where possible; this does not certify perceptual diversity.
    groups=collections.defaultdict(list)
    for voice in sorted(voices,key=lambda v:v['id']): groups[str(voice.get('gender','unknown'))].append(voice)
    ordered=[]
    while any(groups.values()):
        for group in groups.values():
            if group: ordered.append(group.pop(0))
    if len(ordered)<n: raise ValueError(f'Only {len(ordered)} eligible voices; requested {n}.')
    return ordered[:n]

def plan(db,args,voices):
    rows=list(db.execute('SELECT * FROM words WHERE bank=? ORDER BY text,ipa',(args.bank,)))
    if not args.all_words:
        selection=TRIAL if args.bank=='en-US-ga' else ('tout tu vous vu rue roue bon beau'.split() if args.bank=='fr' else 'ship sheep port court bat cot book buck'.split())
        if args.bank not in ('en-US-ga','en-GB-ssbe','fr'):
            specs=json.loads((HERE/'remaining-banks.json').read_text())
            selection=next(spec['words'] for spec in specs if spec['bank']==args.bank)
        rows=[r for r in rows if r['text'] in selection]
        if len({r['text'] for r in rows})!=len(selection):raise ValueError('Audition selection is missing bank words; correct it before generation')
    if args.limit: rows=rows[:args.limit]
    if not rows: raise ValueError('No words selected')
    jobs=[]
    for r in rows:
        for voice in voices:
            job={'wordId':r['id'],'text':r['text'],'targetIPA':r['ipa'],'bank':r['bank'],'locale':voice['locale'],'provider':args.provider,'voice':voice,'reviewStatus':'unreviewed','pronunciationVerified':False,'commercialUse':'unverified'}
            if args.provider=='google':
                job.update(model='Chirp3-HD',modelRevision='provider-managed-unpinned',request={'input':{'text':r['text']},'voice':{'languageCode':LOCALES[args.bank],'name':voice['id']},'audioConfig':{'audioEncoding':'LINEAR16','sampleRateHertz':24000}})
            elif args.provider=='cartesia':
                job.update(model='sonic-3.6',modelRevision='provider-managed-unpinned',commercialUse='private-evaluation-only',request={'model_id':'sonic-3.6','transcript':r['text'],'voice':voice['id'],'locale':CARTESIA_LOCALES[args.bank],'output_format':{'container':'wav','encoding':'pcm_s16le','sample_rate':24000}})
            else: job.update(model='mlx-community/chatterbox-multilingual-v3',modelRevision=MODEL_REV,tokenizerRevision=TOKENIZER_REV,settings={**SETTINGS,'lang_code':('en' if args.bank.startswith('en-') else args.bank)},seed=int(identity([r['id'],voice['id']])[:8],16))
            if args.bank=='ja':
                job['speechText']=json.loads(r['data']).get('reading') or r['text']
            job['id']=identity(job); jobs.append(job)
    return jobs

class Chatterbox:
    def __init__(self,bank='en-US-ga'):
        self.bank=bank
        old=AUDIO/'english-quick-audition-20261001/chatterbox'
        manifest=json.loads((old/'manifest.json').read_text())
        if manifest['modelRevision']!=MODEL_REV or manifest['tokenizerRevision']!=TOKENIZER_REV: raise ValueError('Existing model revision differs from runner pin')
        tokenizer=old/'hf-cache/hub/models--mlx-community--S3TokenizerV2/snapshots'/TOKENIZER_REV
        if not tokenizer.exists(): raise ValueError('Pinned tokenizer not installed')
        os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
        import huggingface_hub
        def download(*args,**kwargs):
            if kwargs.get('repo_id',args[0] if args else None)=='mlx-community/S3TokenizerV2': return str(tokenizer)
            raise ValueError('Unexpected model download blocked')
        huggingface_hub.snapshot_download=download
        import mlx.core as mx
        import soundfile as sf
        from mlx_audio.tts.utils import load_model
        self.mx=mx; self.model=load_model(str(old/'model'));self.conditions={}
        for label,(filename,expected) in bank_refs(self.bank).items():
            p=AUDIO/'fixed-reference-expansion/private/references'/filename
            if sha(p.read_bytes())!=expected: raise ValueError('Reference changed')
            samples,sr=sf.read(p,dtype='float32')
            if samples.ndim>1:samples=samples.mean(axis=1)
            self.conditions[label]=self.model.prepare_conditionals(mx.array(samples),sr,SETTINGS['exaggeration'])
    def generate(self,job,path):
        import numpy as np
        import soundfile as sf
        self.mx.random.seed(job['seed'])
        results=list(self.model.generate(job.get('speechText',job['text']),conds=self.conditions[job['voice']['id']],**job['settings']))
        if not results or len({r.sample_rate for r in results})!=1: raise ValueError('Invalid synthesis result')
        samples=np.concatenate([np.asarray(r.audio).reshape(-1) for r in results])
        sf.write(path,samples,results[0].sample_rate,subtype='PCM_16')

def audit(path):
    import soundfile as sf
    import numpy as np
    samples,sr=sf.read(path)
    if not samples.size or not np.isfinite(samples).all(): raise ValueError('Invalid audio')
    duration=len(samples)/sr;peak=float(np.abs(samples).max());rms=float(np.sqrt(np.mean(samples**2)))
    flags=[]
    if duration<.15 or duration>4: flags.append('duration_outlier')
    if rms<.003: flags.append('quiet_or_silent')
    if peak>=.999: flags.append('possible_clipping')
    return {'duration':duration,'sampleRate':sr,'peak':peak,'rms':rms,'flags':flags,'pronunciationCheck':'not_performed'}

def generate(db,args):
    # Account/catalog checks occur before reserving spend or constructing a model.
    voices=pick_voices(catalog(args.provider,args.bank),args.voices or (2 if args.provider=='chatterbox' else 4))
    jobs=plan(db,args,voices)
    print(dumps({'plannedClips':len(jobs),'words':len(jobs)//len(voices),'voices':voices,'bulk':args.all_words}),flush=True)
    if not args.execute: return
    model=None; transport=None; g=None
    if args.provider=='google':
        g=google_module();transport=g.GoogleTransport(g.AUTHORIZED_PROJECT)
    output=STATE/'clips';output.mkdir(exist_ok=True)
    for index,job in enumerate(jobs):
        prior=db.execute('SELECT * FROM clips WHERE id=?',(job['id'],)).fetchone()
        if prior:
            if prior['status']=='complete' and Path(prior['path']).exists() and sha(Path(prior['path']).read_bytes())==prior['sha']:
                print(f"Cached {index+1}/{len(jobs)} {job['text']}",flush=True);continue
            raise ValueError('Existing incomplete or changed recording requires review; no automatic repeat: '+job['id'])
        if args.provider=='chatterbox' and model is None: model=Chatterbox(args.bank)
        path=output/(job['id']+'.wav')
        # Durable state before any request; interruptions never repeat a possibly billed call.
        if args.provider=='cartesia':
            used=int(db.execute("SELECT coalesce(sum(json_extract(details,'$.reservedCharacters')),0) FROM clips WHERE provider='cartesia'").fetchone()[0])
            reserve=len(job['text'].encode())
            if used+reserve>2000: raise ValueError('Private Cartesia audition cap of 2,000 characters reached. Check actual account credits before raising it.')
            job['reservedCharacters']=reserve
        db.execute('INSERT INTO clips(id,word_id,provider,voice,status,details,path) VALUES(?,?,?,?,?,?,?)',(job['id'],job['wordId'],args.provider,job['voice']['id'],'attempting',dumps(job),str(path)));db.commit()
        try:
            if g:
                g.BUDGET_DIR.mkdir(exist_ok=True)
                with (g.BUDGET_DIR/'.budget.lock').open('a+') as lock:
                    fcntl.flock(lock,fcntl.LOCK_EX);oldroot=g.HERE/'candidate'
                    g.initialize_budget(oldroot,g.AUTHORIZED_PROJECT)
                    g.reserve_charge(oldroot,g.AUTHORIZED_PROJECT,{'cacheKey':job['id'],'settings':{'request':job['request']}})
                    payload=transport.synthesize(job['request']);path.write_bytes(base64.b64decode(payload['audioContent'],validate=True))
                    g.record_outcome(oldroot,g.AUTHORIZED_PROJECT,job['id'],'saved')
            elif args.provider=='cartesia':path.write_bytes(cartesia_request('tts/bytes',job['request']))
            else:model.generate(job,path)
            job['technicalAudit']=audit(path)
            db.execute('UPDATE clips SET status=?,details=?,sha=? WHERE id=?',('complete',dumps(job),sha(path.read_bytes()),job['id']));db.commit()
            print(f"Saved {index+1}/{len(jobs)} {job['text']} / {job['voice']['name']} — unreviewed",flush=True)
        except BaseException:
            db.execute('UPDATE clips SET status=? WHERE id=?',('needs-investigation',job['id']));db.commit();raise
    report(db)

def report(db):
    rows=[]
    for row in db.execute('SELECT * FROM words ORDER BY bank,text,ipa'):
        w=dict(row);w['data']=json.loads(w['data']);w['flags']=json.loads(w['flags']);w['clips']=[]
        for c in db.execute('SELECT * FROM clips WHERE word_id=?',(w['id'],)):
            clip=dict(c);clip['details']=json.loads(clip['details']);clip['url']='clips/'+Path(clip['path']).name+'?v='+str(clip['sha'] or '');clip.pop('path');w['clips'].append(clip)
        rows.append(w)
    (STATE/'review-data.json').write_text(dumps(rows))
    (STATE/'index.html').write_text((HERE/'review.html').read_text())
    english=[w for w in rows if w['bank'].startswith('en-')]
    result={'database':str(STATE/'audio.sqlite3'),'words':len(rows),'englishWords':len(english),'englishWordsFlagged':sum(bool(w['flags']) for w in english),'clipStates':dict(db.execute('SELECT status,count(*) FROM clips GROUP BY status'))}
    print(dumps(result))
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['init','catalog','generate','report','serve']);p.add_argument('--provider',choices=['chatterbox','google','cartesia'],default='chatterbox');p.add_argument('--bank',choices=list(LOCALES),default='en-US-ga');p.add_argument('--voices',type=int);p.add_argument('--limit',type=int);p.add_argument('--all-words',action='store_true');p.add_argument('--execute',action='store_true');p.add_argument('--port',type=int,default=63119);args=p.parse_args()
    if args.voices is not None and not 1<=args.voices<=8:p.error('Use 1–8 voices')
    if args.limit is not None and args.limit<1:p.error('Limit must be positive')
    credentials=STATE/'credentials.json'
    if credentials.exists():
        saved=json.loads(credentials.read_text())
        if saved.get('cartesia'):os.environ.setdefault('CARTESIA_API_KEY',saved['cartesia'])
    db=connect()
    with (STATE/'.run.lock').open('a+') as lock:
        if args.command!='serve':
            if args.command=='generate':
                print('Waiting for any current recording batch to finish…',flush=True)
                fcntl.flock(lock,fcntl.LOCK_EX)
            else:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.command=='init':init(db);report(db)
        elif args.command=='catalog':print(dumps(catalog(args.provider,args.bank)))
        elif args.command=='generate':generate(db,args)
        else:report(db)
    if args.command=='serve':
        from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
        class Handler(SimpleHTTPRequestHandler):
            def __init__(self,*a,**kw):super().__init__(*a,directory=str(STATE),**kw)
            def do_GET(self):
                path=urllib.parse.urlparse(self.path).path
                if path not in ['/','/index.html','/review-data.json'] and not re.fullmatch(r'/clips/[0-9a-f]{64}\.wav',path):self.send_error(404);return
                super().do_GET()
            def do_HEAD(self):self.send_error(405)
        print(f'Review: http://127.0.0.1:{args.port}',flush=True)
        ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
if __name__=='__main__':
    try:main()
    except Exception as e: print('Stopped: '+str(e),file=sys.stderr);sys.exit(1)
