#!/usr/bin/env python3
"""Isolated fictional-reference Qwen Base experiment. No public-audio mutation."""
import argparse, gc, hashlib, importlib.metadata, json, pathlib, subprocess, time
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
DESIGN = ('mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit', '5c390979e4b93af5f2932f90742ca99c7dd04687')
BASE = ('mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit', '0d6bb6fe33f92d47a507e23b9148940e8366ab5b')
SPECS = {
    'en': {'language':'English','locale':'en-US','dialect':'General American English','contrastId':'en-i-ih',
        'pairIds':['en-ship-sheep','en-fill-feel','en-sit-seat'],
        'referenceText':'I can hear the quiet room around me. Today we will listen carefully, take our time, and notice the small details in ordinary speech.'},
    'fr': {'language':'French','locale':'fr-FR','dialect':'standard metropolitan French from France','contrastId':'fr-u-y',
        'pairIds':['fr-tout-tu','fr-vous-vu','fr-roue-rue'],
        'referenceText':"La pièce est calme et la fenêtre est ouverte. Aujourd'hui, nous prenons le temps d'écouter attentivement les petits détails de la parole."},
}
STYLES = {'a':'An adult woman with a clear, relaxed middle-pitched voice.', 'b':'An adult man with a warm, clear lower-pitched voice.'}
REFERENCE_TEXT_OVERRIDES = {'en-a':'Today we listen carefully and notice small details in ordinary speech.'}
# Preserve the actual profile indices used by the accepted experiment, including
# the en-a recovery. Reference hash remains part of every asset identity.
WORD_SEED_INDICES = {'en-a':3, 'en-b':1, 'fr-a':2, 'fr-b':3}
CONDITIONING = 'Qwen Base ICL: fixed reference waveform speaker embedding, reference speech codes, and exact supplied reference transcript'

def now(): return datetime.now(timezone.utc).isoformat()
def hashed(data): return hashlib.sha256(data).hexdigest()
def file_hash(path): return hashed(path.read_bytes())
def write(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n'); temporary.replace(path)
def event(value):
    value = {'at':now(),**value}
    with (HERE/'private/generation-log.jsonl').open('a') as f: f.write(json.dumps(value,ensure_ascii=False)+'\n')
    print(json.dumps(value,ensure_ascii=False),flush=True)
def probe(path):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=sample_rate,channels:format=duration','-of','json',str(path)],text=True))

def words_by_language():
    document=json.loads((HERE.parent.parent/'content/curriculum.json').read_text())
    output={}
    for language_id,spec in SPECS.items():
        language=next(l for l in document['languages'] if l['id']==language_id)
        contrast=next(c for c in language['contrasts'] if c['id']==spec['contrastId'])
        selected=[next(p for p in contrast['pairs'] if p['id']==pair_id) for pair_id in spec['pairIds']]
        items={}
        for pair in selected:
            for index,word in enumerate(pair['words']):
                items[word['text']]={'text':word['text'],'targetIPA':word['ipa'],'meaning':word['meaning'],'pairId':pair['id'],'categoryIndex':index}
        assert len(items)==6
        output[language_id]=list(items.values())
    return output

def collect(outputs, path, elapsed, maximum_tokens):
    import numpy as np, soundfile as sf
    if not outputs: raise RuntimeError('Model returned no waveform')
    data=np.concatenate([np.asarray(part.audio,dtype=np.float32) for part in outputs])
    rate=int(outputs[0].sample_rate)
    if not len(data) or not np.isfinite(data).all(): raise RuntimeError('Empty or non-finite waveform')
    peak=float(np.max(np.abs(data))); scale=min(1.,.98/peak) if peak else 1.
    sf.write(path,data*scale,rate,subtype='PCM_16')
    info={'sampleRate':rate,'samples':len(data),'durationSeconds':len(data)/rate,'peakBeforeAdjustment':peak,'peakScale':scale,
        'rmsBeforeAdjustment':float(np.sqrt(np.mean(data.astype(np.float64)**2))),'generationSeconds':elapsed,
        'generationTokenCount':sum(part.token_count for part in outputs),'maxTokens':maximum_tokens,'sourceWavSha256':file_hash(path)}
    return info

def check_generated(info, reference=False):
    low,high=(3.,18.) if reference else (.16,3.2)
    reasons=[]
    if not low <= info['durationSeconds'] <= high: reasons.append(f'duration outside {low}–{high} seconds')
    if info['generationTokenCount'] >= info['maxTokens']: reasons.append('generation token cap reached')
    if info['rmsBeforeAdjustment'] < .00005: reasons.append('near-silent waveform')
    return reasons

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute',action='store_true')
    parser.add_argument('--takes',type=int,default=3)
    args=parser.parse_args()
    if not 1 <= args.takes <= 3: raise ValueError('Bounded experiment allows one to three takes')
    items=words_by_language()
    print(json.dumps({'languages':list(SPECS),'profiles':4,'words':12,'takesPerProfileWord':args.takes,'plannedClips':24*args.takes,'publicAudioChanged':False,'execute':args.execute}),flush=True)
    if not args.execute:return
    for sub in ['private/references','private/originals','private/rejected','clips']:(HERE/sub).mkdir(parents=True,exist_ok=True)
    import mlx.core as mx, numpy as np
    from huggingface_hub import snapshot_download
    from mlx_audio.tts.utils import load_model
    from mlx_audio.utils import load_audio
    versions={name:importlib.metadata.version(name) for name in ['mlx-audio','mlx','numpy','soundfile','huggingface-hub']}
    started=time.perf_counter()
    design_path=snapshot_download(DESIGN[0],revision=DESIGN[1],local_files_only=True)
    base_path=snapshot_download(BASE[0],revision=BASE[1],local_files_only=True)
    reference_file=HERE/'references.json'
    references=json.loads(reference_file.read_text())['references'] if reference_file.exists() else []
    existing={r['profileKey']:r for r in references}
    design_model=None
    for language_index,(language_id,spec) in enumerate(SPECS.items()):
        for slot_index,(slot,style) in enumerate(STYLES.items()):
            key=f'{language_id}-{slot}'
            reference_text=REFERENCE_TEXT_OVERRIDES.get(key,spec['referenceText'])
            if key in existing:
                assert file_hash(HERE/existing[key]['privateWavPath'])==existing[key]['referenceSha256']
                continue
            if design_model is None:
                event({'stage':'load-design','model':DESIGN[0]});design_model=load_model(design_path)
                assert design_model.config.tts_model_type=='voice_design'
            instruction=f'An original fictional voice, not an imitation of any real person. {style} A native speaker of {spec["dialect"]}. Speak in a neutral conversational tone at a normal pace. Read the exact provided text once with no added words or sounds.'
            for attempt in range(3):
                seed=928000+language_index*100+slot_index*10+attempt
                path=HERE/'private/references'/f'{key}-seed-{seed}.wav'
                event({'stage':'reference-start','profile':key,'seed':seed});mx.random.seed(seed);tick=time.perf_counter()
                outputs=list(design_model.generate_voice_design(text=reference_text,language=spec['language'],instruct=instruction,temperature=.65,top_p=.9,max_tokens=260))
                info=collect(outputs,path,time.perf_counter()-tick,260)
                reasons=check_generated(info,reference=True)
                if reasons:
                    path.rename(HERE/'private/rejected'/path.name);event({'stage':'reference-rejected','profile':key,'seed':seed,'reasons':reasons,'metrics':info});continue
                reference={'profileKey':key,'languageId':language_id,'voiceId':f'qwen-fixed-{key}-{info["sourceWavSha256"][:8]}','intendedLocale':spec['locale'],'intendedDialect':spec['dialect'],
                    'referenceText':reference_text,'referenceTextSha256':hashed(reference_text.encode()),'referenceSha256':info['sourceWavSha256'],
                    'privateWavPath':str(path.relative_to(HERE)),'referenceModel':DESIGN[0],'referenceModelRevision':DESIGN[1],'seed':seed,'instruction':instruction,
                    'provenance':'Original fictional synthetic reference generated locally; no real-person source recording','synthetic':True,'modelLicense':'Apache-2.0',
                    'status':'generated-unreviewed','phoneticListeningVerified':False,'speakerConsistencyVerified':False,'createdAt':now(),**info}
                references.append(reference);existing[key]=reference
                write(reference_file,{'runtimeVersions':versions,'references':references})
                event({'stage':'reference-complete','profile':key,'seconds':info['durationSeconds'],'generationSeconds':info['generationSeconds'],'hash':reference['referenceSha256']});break
            else:raise RuntimeError(f'No engineering-acceptable reference after three tries: {key}')
    if design_model is not None:del design_model
    gc.collect();mx.clear_cache()
    event({'stage':'load-base','model':BASE[0]})
    model=load_model(base_path)
    assert model.config.tts_model_type=='base' and model.speaker_encoder is not None
    assert model.speech_tokenizer is not None and model.speech_tokenizer.has_encoder
    inventory_file=HERE/'take-inventory.json'
    clips=json.loads(inventory_file.read_text())['clips'] if inventory_file.exists() else []
    completed={(c['voiceId'],c['text'],c['take']):c for c in clips}
    unavailable=[]
    for reference_index,reference in enumerate(references):
        language_id=reference['languageId'];spec=SPECS[language_id];wav=HERE/reference['privateWavPath']
        assert file_hash(wav)==reference['referenceSha256']
        model._icl_cache.clear()  # Keep reference-code reuse within one profile only.
        ref_array=load_audio(str(wav),sample_rate=model.sample_rate)
        embedding=model.extract_speaker_embedding(ref_array)
        embedding_hash=hashed(np.asarray(embedding,dtype=np.float32).tobytes())
        reference['baseSpeakerEmbeddingSha256']=embedding_hash
        write(reference_file,{'runtimeVersions':versions,'references':references})
        for word_index,word in enumerate(items[language_id]):
            for take in range(args.takes):
                key=(reference['voiceId'],word['text'],take)
                if key in completed:
                    assert file_hash(HERE/completed[key]['privateWavPath'])==completed[key]['sourceWavSha256']
                    assert file_hash(HERE/'clips'/pathlib.Path(completed[key]['url']).name)==completed[key]['sha256']
                    continue
                for attempt in range(3):
                    seed=1928000+WORD_SEED_INDICES[reference['profileKey']]*10000+word_index*100+take*10+attempt
                    settings={'model':BASE[0],'revision':BASE[1],'language':spec['language'],'text':word['text'],'referenceSha256':reference['referenceSha256'],
                        'referenceTextSha256':reference['referenceTextSha256'],'seed':seed,'take':take,'temperature':.65,'topP':.9,'maxTokens':60,
                        'runtimeVersions':versions,'encoding':'192k-mp3-original-rate-mono'}
                    clip_id=hashed(json.dumps(settings,sort_keys=True,ensure_ascii=False).encode())[:28]
                    original=HERE/'private/originals'/f'{clip_id}.wav'
                    event({'stage':'word-start','voice':reference['voiceId'],'word':word['text'],'take':take,'attempt':attempt,'seed':seed})
                    mx.random.seed(seed);tick=time.perf_counter()
                    outputs=list(model.generate(text=word['text'],lang_code=spec['language'].lower(),ref_audio=str(wav),ref_text=reference['referenceText'],temperature=.65,top_p=.9,max_tokens=60,verbose=False,stream=False))
                    if not outputs:
                        event({'stage':'word-rejected','voice':reference['voiceId'],'word':word['text'],'take':take,'seed':seed,'reasons':['model returned no waveform (immediate EOS)'],'generationSeconds':time.perf_counter()-tick})
                        continue
                    info=collect(outputs,original,time.perf_counter()-tick,60)
                    reasons=check_generated(info)
                    if reasons:
                        original.rename(HERE/'private/rejected'/original.name)
                        event({'stage':'word-rejected','voice':reference['voiceId'],'word':word['text'],'take':take,'seed':seed,'reasons':reasons,'metrics':info});continue
                    output=HERE/'clips'/f'{clip_id}.mp3'
                    subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(original),'-map_metadata','-1','-ac','1','-c:a','libmp3lame','-b:a','192k',str(output)],check=True)
                    encoded=probe(output)
                    subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(output),'-f','null','-'],check=True,stdout=subprocess.DEVNULL)
                    assert abs(float(encoded['format']['duration'])-info['durationSeconds'])<.15
                    clip={'id':clip_id,'languageId':language_id,'text':word['text'],'voiceId':reference['voiceId'],'take':take,'targetIPA':word['targetIPA'],'pairId':word['pairId'],
                        'url':f'/audio/fixed-speaker-pilot/clips/{clip_id}.mp3','status':'generated-unreviewed','provider':'qwen-base-fixed-reference','synthetic':True,
                        'phoneticListeningVerified':False,'speakerConsistencyVerified':False,'intendedLocale':spec['locale'],'intendedDialect':spec['dialect'],
                        'conditioningMechanism':CONDITIONING,'referenceSha256':reference['referenceSha256'],'referenceTextSha256':reference['referenceTextSha256'],
                        'baseSpeakerEmbeddingSha256':embedding_hash,'referenceRemoval':'Installed MLX Base ICL decoder removes its reference prefix internally; no additional word trimming applied',
                        'referenceProvenance':reference['provenance'],'privateReferencePath':reference['privateWavPath'],'privateWavPath':str(original.relative_to(HERE)),
                        'modelLicense':'Apache-2.0','modelLicenseUrl':'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base','model':BASE[0],'modelRevision':BASE[1],
                        'generationSettings':settings,'sha256':file_hash(output),'bytes':output.stat().st_size,'encodedDurationSeconds':float(encoded['format']['duration']),
                        'createdAt':now(),**info}
                    clips.append(clip);completed[key]=clip
                    write(inventory_file,{'status':'candidate-unreviewed','conditioningMechanism':CONDITIONING,'clips':clips})
                    event({'stage':'word-complete','voice':reference['voiceId'],'word':word['text'],'take':take,'count':len(clips),'seconds':info['durationSeconds'],'generationSeconds':info['generationSeconds']});break
                else:unavailable.append({'voiceId':reference['voiceId'],'text':word['text'],'take':take})
    primary=[c for c in clips if c['take']==0]
    voices={l:[{'id':r['voiceId'],'name':f'Fixed reference {r["profileKey"][-1].upper()}','description':f'Experimental synthetic {SPECS[l]["dialect"]} profile; intended accent and consistency unreviewed',
        'source':'synthetic-fixed-reference','referenceSha256':r['referenceSha256'],'referenceTextSha256':r['referenceTextSha256'],'speakerConsistencyVerified':False} for r in references if r['languageId']==l] for l in SPECS}
    manifest={'schemaVersion':1,'status':'private-candidate-not-deployed','publicDeploymentApproved':False,'createdAt':now(),'voicesByLanguage':voices,'clips':primary,
        'eligibleContrasts':[{'languageId':l,'contrastId':s['contrastId'],'pairIds':s['pairIds'],'completeForListedPairs':all(any(c['languageId']==l and c['voiceId']==v['id'] and c['text']==w['text'] for c in primary) for v in voices[l] for w in items[l])} for l,s in SPECS.items()],
        'scopeNote':'Primary manifest selects take 0 only, preventing ambiguous duplicate word/voice lookups. Other takes are listed separately for review; current app audio adapter does not select takes.',
        'phoneticListeningVerified':False,'speakerConsistencyVerified':False}
    write(HERE/'manifest.candidate.json',manifest)
    write(HERE/'run-summary.json',{'completedAt':now(),'elapsedSeconds':time.perf_counter()-started,'referenceCount':len(references),'plannedClips':24*args.takes,'clipCount':len(clips),
        'primaryCount':len(primary),'audioBytes':sum(c['bytes'] for c in clips),'primaryAudioBytes':sum(c['bytes'] for c in primary),'unavailable':unavailable,
        'runtimeVersions':versions,'publicAudioChanged':False,'phoneticListeningVerified':False,'speakerConsistencyVerified':False})
    event({'stage':'complete','references':len(references),'clips':len(clips),'primaryClips':len(primary),'unavailable':len(unavailable)})
    if unavailable:raise SystemExit(2)

if __name__=='__main__':main()
