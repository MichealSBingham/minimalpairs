"""Create two fixed fictional US reference voices locally, once."""
import os,json
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
import studio as s
import mlx.core as mx
import numpy as np
import soundfile as sf
from huggingface_hub import snapshot_download
from mlx_audio.tts.utils import load_model
REPO='mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit'
REV='5c390979e4b93af5f2932f90742ca99c7dd04687'
out=s.STATE/'extra-voices.json'
if out.exists():raise SystemExit('References already created; refusing overwrite.')
model=load_model(snapshot_download(REPO,revision=REV,local_files_only=True))
text='The morning light fills the room. I take a breath, speak clearly, and listen to the small details in every word.'
voices=[]
for label,style,seed in [('C','An adult woman with a low, smooth, resonant voice and crisp articulation.',1001020),('D','An adult man with a bright, light tenor voice and clear articulation.',1001030)]:
    instruction='An original fictional voice, not an imitation of any real person. '+style+' A native speaker of General American English. Speak naturally at a normal pace, without whispering, vocal fry, or theatrical expression. Read the exact text once, with no added words or sounds.'
    mx.random.seed(seed)
    results=list(model.generate_voice_design(text=text,language='English',instruct=instruction,temperature=.65,top_p=.9,max_tokens=260))
    samples=np.concatenate([np.asarray(r.audio).reshape(-1) for r in results])
    if not samples.size or not np.isfinite(samples).all():raise ValueError('Invalid reference audio')
    filename=f'en-{label.lower()}-seed-{seed}.wav';path=s.AUDIO/'fixed-reference-expansion/private/references'/filename
    if path.exists():raise ValueError('Reference already exists')
    sf.write(path,samples,results[0].sample_rate,subtype='PCM_16')
    voices.append({'label':label,'filename':filename,'sha256':s.sha(path.read_bytes()),'referenceText':text,'instruction':instruction,'model':REPO,'revision':REV,'seed':seed,'accentVerified':False,'status':'audition-unreviewed'})
    print(f'Created fictional reference {label}',flush=True)
out.write_text(s.dumps(voices))
