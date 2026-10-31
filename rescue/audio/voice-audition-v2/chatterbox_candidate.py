#!/usr/bin/env python3
"""Bounded local Mandarin audition, adapted from the exact 2026-10-01 runner.

Without --generate this only prints the selected word IDs. Weights must already
exist under models/ with their recorded provenance. No downloads, repairs or
human approvals occur here. A new run directory is required every time.

Examples (from repository root, using the local MLX Python environment):
  python rescue/audio/voice-audition-v2/chatterbox_candidate.py --run-id inspect
  python rescue/audio/voice-audition-v2/chatterbox_candidate.py --run-id new-smoke --scope smoke4 --generate
  python rescue/audio/voice-audition-v2/chatterbox_candidate.py --run-id new-full --reuse-run new-smoke --generate

The second command synthesizes only the four frozen ma words; the third copies
those byte-identically and synthesizes the remaining twelve once. Merely saving
this adapter is not permission for further generation. Reproducing seeds does
not guarantee byte-identical output across hardware/runtime versions.
"""
from pathlib import Path
import argparse,os,json,hashlib,datetime,time,shutil,re
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-id',required=True)
parser.add_argument('--scope',choices=['smoke4','full16'],default='full16')
parser.add_argument('--reuse-run',help='Copy matching clips from an existing complete local run; never regenerate them.')
parser.add_argument('--generate',action='store_true',help='Actually synthesize the bounded selected audition after separate authorization.')
args=parser.parse_args()
for value in [args.run_id,args.reuse_run]:
 if value is not None and not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,79}',value):parser.error('Run IDs must be simple lowercase local directory names.')
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
BASE=Path(__file__).resolve().parents[2]
HERE=BASE/'audio/voice-audition-v2'
MODEL=HERE/'models/chatterbox-multilingual-v2';TOKENIZER=HERE/'models/s3-tokenizer-v2'
SIDECAR=BASE/'content/phoneme-research/mandarin-balance.json'
OUT=HERE/'runs'/args.run_id
PREVIOUS=HERE/'runs'/args.reuse_run if args.reuse_run else None
previous=json.loads((PREVIOUS/'manifest.json').read_text()) if PREVIOUS else {'status':'complete','clips':[]}
assert previous['status']=='complete'
assert not OUT.exists(),'Refusing to overwrite previous audition'
s=json.loads(SIDECAR.read_text());byid={w['id']:w for w in s['lexicalItems']};all_chosen=[byid[i] for i in s['audition']['wordIds']]
assert hashlib.sha256(SIDECAR.read_bytes()).hexdigest()=='b4ed45910487b89ba4fdf25be073f2794c886a0cb306985eedb5552977044509','Frozen audition source changed; stop for explicit review'
assert len(all_chosen)==16 and all(w['split']=='train' for w in all_chosen)
if args.scope=='smoke4':all_chosen=[w for w in all_chosen if w['segmentalFrame']=='ma']
selected_ids={w['id'] for w in all_chosen}
assert len(all_chosen)==(4 if args.scope=='smoke4' else 16)
oldids={c['wordId'] for c in previous['clips']}
chosen=[w for w in all_chosen if w['id'] not in oldids]
assert len(oldids)==len(previous['clips']) and oldids.issubset(selected_ids)
assert len(chosen)+len(oldids)==len(all_chosen)<=16
if PREVIOUS:assert previous['wordsetSha256']==hashlib.sha256(SIDECAR.read_bytes()).hexdigest()
if not args.generate:
 print(json.dumps({'mode':'selection-only','scope':args.scope,'selectedWordIds':[w['id'] for w in all_chosen],'copiedClips':len(oldids),'newGenerationCap':len(chosen),'attemptsPerNewWord':1},ensure_ascii=False,indent=2));raise SystemExit(0)
mp=json.loads((MODEL/'provenance.json').read_text());tp=json.loads((TOKENIZER/'provenance.json').read_text())
for folder,provenance in [(MODEL,mp),(TOKENIZER,tp)]:
 for f in provenance['files']:
  assert hashlib.file_digest((folder/f['file']).open('rb'),'sha256').hexdigest()==f['sha256'],f['file']
assert mp['repo']=='mlx-community/chatterbox-fp16' and mp['revision']=='4923fcca09086356aeab5191a2348c5a17a23694'
assert json.loads((MODEL/'config.json').read_text())['multilingual'] is True
condhash=hashlib.sha256((MODEL/'conds.safetensors').read_bytes()).hexdigest()
settings={'lang_code':'zh','exaggeration':0.1,'cfg_weight':0.5,'temperature':0.8,'repetition_penalty':1.2,'min_p':0.05,'top_p':1.0,'max_new_tokens':96,'verbose':False,'stream':False}
limitations=['One bundled synthetic default voice; speaker identity, native accent and Mandarin tone accuracy are unverified.','Model-card Chinese support is not proof of correct isolated monosyllables.','MLX community multilingual v2 conversion, not the newer Mandarin-specific V3 finetune.','Technical checks and later ASR are triage only; every pronunciation review remains pending.','GenerationResult.token_count in this installed adapter counts input tokens; speech EOS and length are captured separately.','Input is exactly the selected character followed by a full stop; no carrier phrase, reading hint, crop, speed adjustment or tone manipulation is applied.']
report={'schemaVersion':1,'id':OUT.name,'textBankId':'text-bank-v2','purpose':'Bounded frozen Mandarin second-engine audition; reused files copied unchanged and new words generated once; not approved learner audio.','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'provider':'chatterbox-local-mlx','model':mp['repo'],'modelRevision':mp['revision'],'wordsetSha256':hashlib.sha256(SIDECAR.read_bytes()).hexdigest(),'status':'running','providerNotes':limitations,'limitations':limitations,'license':{'upstream':'MIT','upstreamUrl':'https://github.com/resemble-ai/chatterbox/blob/master/LICENSE','conversionModelCard':'Apache-2.0','conversionUrl':'https://huggingface.co/mlx-community/chatterbox-fp16'},'conditioning':{'sourceRepo':mp['repo'],'sourceRevision':mp['revision'],'file':'conds.safetensors','sha256':condhash,'identity':'packaged-default-not-a-verified-native-speaker'},'tokenizerProvenance':tp,'clips':[]}
OUT.mkdir(parents=True);(OUT/'clips').mkdir();shutil.copy2(__file__,OUT/'generation.py')
def save(): (OUT/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for old in previous['clips']:
 assert old['generationSettings']==settings and old['technicalStatus']=='pass'
 src=PREVIOUS/'clips'/old['fileName'];assert hashlib.sha256(src.read_bytes()).hexdigest()==old['sha256']
 dest=OUT/'clips'/old['fileName'];shutil.copy2(src,dest)
 assert hashlib.sha256(dest.read_bytes()).hexdigest()==old['sha256']
 copied=dict(old);copied.update(locale='cmn-CN',requestedLanguage='zh',synthesisText=old['inputText'],url='/audio/audition-v2/'+OUT.name+'/'+old['fileName'],copiedFrom={'runId':PREVIOUS.name,'clipId':old['id'],'sha256':old['sha256']})
 report['clips'].append(copied)
report['preservedClips']=len(oldids);report['newGenerationCap']=len(chosen);report['attemptsPerNewWord']=1
save()
# Pin the one auxiliary lookup to already downloaded and hashed local assets.
import huggingface_hub
original_snapshot=huggingface_hub.snapshot_download
def offline_snapshot(*args,**kwargs):
 repo=kwargs.get('repo_id',args[0] if args else None)
 if repo=='mlx-community/S3TokenizerV2':return str(TOKENIZER)
 raise RuntimeError('Unexpected model download: '+str(repo))
huggingface_hub.snapshot_download=offline_snapshot
import mlx.core as mx,numpy as np,soundfile as sf
from mlx_audio.tts.utils import load_model
started=time.monotonic();model=load_model(str(MODEL));assert model._conds is not None
original_inference=model.t3.inference
speech_info={}
def measured_inference(*args,**kwargs):
 out=original_inference(*args,**kwargs); tokens=out.tolist()[0]
 speech_info.clear();speech_info.update(speechTokenCount=max(0,len(tokens)-1),speechEosEmitted=bool(tokens and tokens[-1]==model.t3.hp.stop_speech_token))
 return out
model.t3.inference=measured_inference
for word in chosen:
 profile='chatterbox-v2-bundled-default-'+condhash[:12]
 seed=int(hashlib.sha256((word['id']+'|'+profile+'|1').encode()).hexdigest()[:8],16)
 clipid=word['id']+'-chatterbox-v2-'+hashlib.sha256(json.dumps({'settings':settings,'seed':seed,'conditioning':condhash},sort_keys=True).encode()).hexdigest()[:10]
 clip={'id':clipid,'wordId':word['id'],'bankId':'zh','languageId':'zh','text':word['text'],'reading':word['romanization'],'ipa':word['ipa'],'meaning':word['meaning'],'provider':'chatterbox-local-mlx','model':mp['repo'],'modelRevision':mp['revision'],'voiceId':profile,'speaker':'Bundled default (unverified accent)','locale':'cmn-CN','requestedLanguage':'zh','language':'Chinese','seed':seed,'take':1,'url':'/audio/audition-v2/'+OUT.name+'/'+clipid+'.wav','sha256':None,'technicalStatus':'pending','reviewStatus':'pending','generationSettings':settings,'inputText':word['text']+'。','synthesisText':word['text']+'。'}
 report['clips'].append(clip);save();tick=time.monotonic()
 try:
  mx.random.seed(seed);speech_info.clear()
  parts=list(model.generate(text=clip['inputText'],**settings));assert len(parts)==1
  sr=int(parts[0].sample_rate);audio=np.asarray(parts[0].audio).reshape(-1).astype(np.float32)
  assert audio.size and np.isfinite(audio).all()
  duration=audio.size/sr;peak=float(np.abs(audio).max());rms=float(np.sqrt(np.mean(audio**2)))
  flags=[]
  if duration<0.15:flags.append('very_short')
  if duration>4:flags.append('long_for_isolated_word')
  if peak>1:flags.append('peak_above_full_scale')
  if rms<0.003:flags.append('near_silent')
  if not speech_info.get('speechEosEmitted'):flags.append('speech_eos_not_emitted_before_cap')
  output=OUT/'clips'/f'{clipid}.wav';sf.write(output,audio,sr,subtype='FLOAT')
  clip.update(sha256=hashlib.sha256(output.read_bytes()).hexdigest(),technicalStatus='needs-review' if flags else 'pass',technicalFlags=flags,fileName=output.name,metrics={'durationSeconds':duration,'sampleRate':sr,'peak':peak,'rms':rms,'inputTokenCount':int(parts[0].token_count),**speech_info,'generationSeconds':round(time.monotonic()-tick,3)})
 except Exception as e:clip.update(technicalStatus='failed',technicalFlags=[type(e).__name__+': '+str(e)[:200]])
 save();print(json.dumps({'text':word['text'],'status':clip['technicalStatus'],'metrics':clip.get('metrics'),'flags':clip.get('technicalFlags')},ensure_ascii=False),flush=True);mx.clear_cache()
assert len(report['clips'])==len(all_chosen) and {c['wordId'] for c in report['clips']}==selected_ids
report.update(status='complete',elapsedSeconds=round(time.monotonic()-started,3));save();print('MANIFEST',str(OUT/'manifest.json'),flush=True)
