"""Download a pinned MLX Chatterbox V3 snapshot, then audition 16 English words.

Independent local comparison only. Never modifies application or Qwen audio.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import time
import traceback

HERE = Path(__file__).resolve().parent
OUT = HERE / 'chatterbox'
REPO = 'mlx-community/chatterbox-multilingual-v3'
TOKENIZER_REPO = 'mlx-community/S3TokenizerV2'
SETTINGS = dict(lang_code='en', exaggeration=0.1, cfg_weight=0.5,
                temperature=0.8, repetition_penalty=1.2, min_p=0.05,
                top_p=1.0, max_new_tokens=128, verbose=False, stream=False)
REFS = [
    ('A', 'en-a-seed-928000.wav', '5758a766ae5788c5c77d7dbefd3c6867eb55de61c308d4cdc5fd53b26362fe22'),
    ('B', 'en-b-seed-928010.wav', 'fc29c14cc88bbb38b476ae33ea860498efff6fb98a4e5d3bc95f23878a447eb1'),
]
def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

def save():
    temporary = OUT / 'manifest.tmp.json'
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    temporary.replace(OUT / 'manifest.json')

assert not (OUT / 'manifest.json').exists(), 'Never overwrite a prior Chatterbox run'
OUT.mkdir(exist_ok=True)
(OUT / 'clips').mkdir(exist_ok=True)
os.environ.update(HF_HOME=str(OUT / 'hf-cache'), HF_HUB_DISABLE_TELEMETRY='1',
                  HF_HUB_DISABLE_XET='1', HF_HUB_DOWNLOAD_TIMEOUT='120')
words = json.loads((HERE / 'words.json').read_text())
assert len(words)==16 and len({w['wordId'] for w in words})==16
assert all(w['languageId']=='en' and w['bankId']=='en-US-ga' for w in words)
reference_folder = HERE.parent / 'fixed-reference-expansion/private/references'
for _, name, sha in REFS:
    assert hashlib.sha256((reference_folder/name).read_bytes()).hexdigest()==sha
report = {'id': 'english-chatterbox-v3-20261001', 'status': 'downloading-model',
          'model': REPO, 'language': 'English', 'completed': 0,
          'targetAccent': 'General American requested through English references; unverified',
          'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'referenceProvenance': 'Two existing fictional synthetic English sentence references, originally made with Qwen VoiceDesign. Chatterbox generates all new word recordings. No real person is cloned; reference pronunciation and accent remain unverified.',
          'clips': []}
for word in words:
    for label,name,sha in REFS:
        identity = {'word':word, 'referenceSha256':sha, 'model':REPO, 'settings':SETTINGS}
        clip_id=digest(identity)[:24]
        report['clips'].append({**word,'id':clip_id,'provider':'chatterbox-local-mlx',
            'model':REPO,'speaker':'Chatterbox '+label,'referenceLabel':label,
            'voiceId':'chatterbox-en-'+label.lower()+'-'+sha[:10],
            'referenceSha256':sha,'language':'English','languageCode':'en',
            'accentVerified':False,'seed':int(digest({'wordId':word['wordId'],'voice':label})[:8],16),
            'generationSettings':SETTINGS,'url':'chatterbox/clips/'+clip_id+'.wav',
            'sha256':None,'technicalStatus':'pending','reviewStatus':'pending'})
save()
try:
    from huggingface_hub import HfApi, snapshot_download
    api=HfApi()
    revision=api.model_info(REPO).sha
    tokenizer_revision=api.model_info(TOKENIZER_REPO).sha
    report.update(modelRevision=revision,tokenizerRevision=tokenizer_revision)
    save()
    model_dir=snapshot_download(REPO,revision=revision,local_dir=OUT/'model',
        allow_patterns=['*.json','*.safetensors','README.md'],max_workers=3)
    tokenizer_dir=snapshot_download(TOKENIZER_REPO,revision=tokenizer_revision,
        allow_patterns=['model.safetensors','config.json'],max_workers=2)
    # Pin the library's internal tokenizer request to the downloaded snapshot.
    import huggingface_hub
    original_download=huggingface_hub.snapshot_download
    def pinned_download(*args, **kwargs):
        repo=kwargs.get('repo_id',args[0] if args else None)
        if repo==TOKENIZER_REPO: return tokenizer_dir
        raise ValueError('Unexpected runtime download: '+str(repo))
    huggingface_hub.snapshot_download=pinned_download
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
    report['status']='loading-model';save()
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.utils import load_model
    config=json.loads((Path(model_dir)/'config.json').read_text())
    assert config.get('t3_model')=='v3' and config.get('multilingual') is True
    model=load_model(model_dir)
    conditions={}
    for label,name,_ in REFS:
        reference,sr=sf.read(reference_folder/name,dtype='float32')
        if reference.ndim>1: reference=reference.mean(axis=1)
        conditions[label]=model.prepare_conditionals(mx.array(reference),sr,SETTINGS['exaggeration'])
    report['status']='generating';save()
    started=time.monotonic()
    for index,clip in enumerate(report['clips']):
        try:
            mx.random.seed(clip['seed'])
            results=list(model.generate(clip['text'],conds=conditions[clip['referenceLabel']],**SETTINGS))
            if not results: raise ValueError('No audio returned')
            rates={part.sample_rate for part in results}
            if len(rates)!=1: raise ValueError('Inconsistent sample rates')
            sr=int(rates.pop())
            samples=np.concatenate([np.asarray(part.audio).reshape(-1) for part in results]).astype(np.float32)
            if not samples.size or not np.isfinite(samples).all(): raise ValueError('Invalid waveform')
            duration=len(samples)/sr;peak=float(np.abs(samples).max());rms=float(np.sqrt(np.mean(samples**2)))
            tokens=sum(int(part.token_count) for part in results)
            flags=[]
            if duration<0.15: flags.append('very_short')
            if duration>4: flags.append('long_for_isolated_word')
            if rms<0.003: flags.append('near_silent')
            if peak>1: flags.append('peak_above_full_scale')
            if tokens>=SETTINGS['max_new_tokens']: flags.append('token_cap_reached')
            file=OUT/'clips'/(clip['id']+'.wav')
            sf.write(file,samples,sr,subtype='FLOAT')
            clip.update(sha256=hashlib.sha256(file.read_bytes()).hexdigest(),modelRevision=revision,
                technicalStatus='needs-review' if flags else 'pass',technicalFlags=flags,
                metrics={'durationSeconds':duration,'sampleRate':sr,'peak':peak,'rms':rms,'tokenCount':tokens})
            mx.clear_cache()
        except Exception as error:
            clip.update(technicalStatus='failed',technicalFlags=[type(error).__name__+': '+str(error)[:250]])
            traceback.print_exc()
        report['completed']=index+1;save()
        print(json.dumps({'completed':index+1,'word':clip['text'],'voice':clip['speaker'],'status':clip['technicalStatus']}),flush=True)
    report.update(status='complete',elapsedSeconds=round(time.monotonic()-started,2))
except Exception as error:
    report.update(status='failed',error=type(error).__name__+': '+str(error)[:400])
    traceback.print_exc()
finally:
    save()
