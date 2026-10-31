#!/usr/bin/env python3
"""Retain small pinned model cards/configs and exact local runtime source hashes."""
import hashlib,importlib.metadata,json,pathlib,platform,shutil,subprocess,sys
from datetime import datetime,timezone
from huggingface_hub import snapshot_download
from run_pilot import BASE,DESIGN
HERE=pathlib.Path(__file__).resolve().parent
dest=HERE/'provenance';dest.mkdir(exist_ok=True)
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
models=[]
for purpose,(repo,revision) in [('reference-design',DESIGN),('fixed-reference-base',BASE)]:
    cache=pathlib.Path(snapshot_download(repo,revision=revision,local_files_only=True))
    records=[]
    for name in ['README.md','config.json','generation_config.json']:
        path=cache/name
        if path.exists():
            target=dest/f'{purpose}-{name}';shutil.copyfile(path,target)
            records.append({'originalPath':name,'retainedPath':str(target.relative_to(HERE)),'sha256':digest(path)})
    weights=[{'file':str(path.relative_to(cache)),'bytes':path.stat().st_size,'sha256':digest(path)} for path in cache.rglob('*.safetensors')]
    models.append({'purpose':purpose,'repo':repo,'revision':revision,'modelCardLicense':'Apache-2.0',
        'pinnedCardUrl':f'https://huggingface.co/{repo}/blob/{revision}/README.md','retainedMetadata':records,'weights':weights})
package=pathlib.Path(importlib.metadata.distribution('mlx-audio').locate_file('mlx_audio'))
sources=[]
for rel in ['tts/models/qwen3_tts/qwen3_tts.py','utils.py']:
    path=package/rel;sources.append({'packagePath':'mlx_audio/'+rel,'sha256':digest(path)})
record={'recordedAt':datetime.now(timezone.utc).isoformat(),'models':models,'runtimeSourceHashes':sources,
    'versions':{p:importlib.metadata.version(p) for p in ['mlx-audio','mlx','numpy','soundfile','huggingface-hub']},
    'pythonVersion':sys.version,'platform':platform.platform(),'processor':platform.processor(),
    'ffmpegVersion':subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0],
    'conditioning':'Fixed synthetic WAV + its exact supplied synthesis text; Base speaker embedding and reference speech codes are reused. The text is not a listening-confirmed transcript.',
    'generationDefaultsRecordedAfterInspection':{'topK':50,'temperature':.65,'topP':.9,'requestedRepetitionPenalty':1.05,'effectiveBaseICLRepetitionPenalty':1.5,'maxWordTokens':60,'maxReferenceTokens':260},
    'sourceReferences':['https://github.com/QwenLM/Qwen3-TTS#voice-design-then-clone',
        'https://github.com/QwenLM/Qwen3-TTS#voice-clone',
        'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base',
        'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
        'https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/models/qwen3_tts/qwen3_tts.py'],
    'rightsNote':'Apache-2.0 is the checkpoint license shown in retained pinned model cards. This is not a claim that generated waveforms are human recordings, CC-licensed, or approved for any third-party voice impersonation. References use original fictional personas only.',
    'referenceChange':{'retiredProfile':'qwen-fixed-en-a-64147c4e','retiredDurationSeconds':12.56,'acceptedTakesBeforeRetirement':4,'missingTakesBeforeRetirement':14,'replacementProfile':'qwen-fixed-en-a-5758a766','replacementDurationSeconds':6.24,
        'reason':'Longer reference repeatedly produced immediate EOS for short words. The complete profile was replaced, never mixed, after one bounded shorter-reference experiment. This is an engineering recovery, not a demonstrated phonetic quality improvement.',
        'retainedEvidence':'private/retired-en-a-long-reference/'},
    'status':'generated-unreviewed','phoneticListeningVerified':False,'speakerConsistencyVerified':False,'publicAudioChanged':False}
(HERE/'provenance.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'models':len(models),'retainedCards':len([x for x in models for y in x['retainedMetadata'] if y['originalPath']=='README.md']),'runtimeHashes':len(sources)}))
