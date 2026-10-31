#!/usr/bin/env python3
"""Bounded isolated word expansion using existing fictional reference waveforms."""
import argparse,hashlib,importlib.metadata,json,os,pathlib,shutil,subprocess,time
from datetime import datetime,timezone
HERE=pathlib.Path(__file__).resolve().parent
PILOT=HERE.parent/'fixed-speaker-pilot'
MODEL='mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit'
REVISION='0d6bb6fe33f92d47a507e23b9148940e8366ab5b'
LANGUAGES={'en':'English','fr':'French'}
PROFILE_ORDER=['en-a','en-b','fr-a','fr-b']
CONDITIONING='Qwen Base ICL using the unchanged accepted fictional reference waveform, speaker embedding, reference speech codes and exact supplied reference text'
def now():return datetime.now(timezone.utc).isoformat()
def hashed(data):return hashlib.sha256(data).hexdigest()
def sha(path):return hashed(path.read_bytes())
def read(path):return json.loads(path.read_text())
def write(path,value):
 temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temp.replace(path)
def event(**value):
 value={'at':now(),**value}
 with(HERE/'private/generation-log.jsonl').open('a')as f:f.write(json.dumps(value,ensure_ascii=False)+'\n')
 print(json.dumps(value,ensure_ascii=False),flush=True)
def scope():
 content=HERE.parent.parent/'content';english=read(content/'english-legacy-batch1-audio-request.json');french=read(content/'french-legacy-batch3-audio-request.json');curriculum=read(content/'curriculum.json');french_candidates=read(content/'french-legacy-batch3-candidates.json')
 ids={'en':english['contrastIds'],'fr':['fr-a-an']};words={};contrasts=[]
 for language_id in ids:
  language=next(l for l in curriculum['languages']if l['id']==language_id)if language_id=='en'else french_candidates;items={}
  for contrast_id in ids[language_id]:
   contrast=next(c for c in language['contrasts']if c['id']==contrast_id);contrasts.append({'languageId':language_id,'contrastId':contrast_id,'pairIds':[p['id']for p in contrast['pairs']],'pairs':[{'id':p['id'],'words':[w['text']for w in p['words']]}for p in contrast['pairs']]})
   for pair in contrast['pairs']:
    for word in pair['words']:
     if word['text']not in items:items[word['text']]={'text':word['text'],'targetIPA':word['ipa'],'meaning':word['meaning'],'pairIds':[],'contrastIds':[],'sources':pair.get('sources',contrast.get('sources',[]))}
     assert items[word['text']]['targetIPA']==word['ipa']
     items[word['text']]['pairIds'].append(pair['id']);items[word['text']]['contrastIds'].append(contrast_id)
  words[language_id]=list(items.values())
 assert {w['text']for w in words['en']}=={w['text']for w in english['newWords']}
 assert {w['text']for w in words['fr']}==set(french['newTrainingWords'])=={'chat','chant','rat','rang','plat','plan'}
 for word in words['en']:
  word['reviewInstruction']=english['dialectWarning']
  word['conditionalReadingRequired']=word['text']in['version','virgin']
 for word in words['fr']:
  word['reviewInstruction']=next(w['reviewInstruction']for w in french['words']if w['text']==word['text'])
  word['conditionalReadingRequired']=word['text']=='rat'
 return {'words':words,'contrasts':contrasts,'frenchCurriculumStatus':'Source-checked isolated batch3 candidate; not live curriculum at generation preflight','inputHashes':{name:sha(content/name)for name in['english-legacy-batch1-audio-request.json','french-legacy-batch3-audio-request.json','french-legacy-batch3-candidates.json','curriculum.json']},'conditionalPairs':english['conditionalPairs'],'targetIPAMechanism':'Target IPA is an annotation and review target; only the unchanged orthographic word is supplied to Base synthesis.'}
def metadata_manifest(clips,refs,scoped):
 voices={lang:[{'id':r['voiceId'],'name':'Fixed reference '+r['profileKey'][-1].upper(),'description':f'Experimental synthetic {r["intendedDialect"]} profile; intended accent and audible identity unreviewed','source':'synthetic-fixed-reference','referenceSha256':r['referenceSha256'],'referenceTextSha256':r['referenceTextSha256'],'speakerConsistencyVerified':False}for r in refs if r['languageId']==lang]for lang in LANGUAGES}
 coverage=[]
 for contrast in scoped['contrasts']:
  words={w for p in contrast['pairs']for w in p['words']};lang=contrast['languageId'];missing=[{'voiceId':v['id'],'text':w}for v in voices[lang]for w in sorted(words)if not any(c['languageId']==lang and c['voiceId']==v['id']and c['text']==w for c in clips)]
  coverage.append({**contrast,'completeForListedPairs':not missing,'completeForEntireContrast':not missing,'missing':missing,'phoneticListeningVerified':False,'assessmentApproved':False})
 return {'schemaVersion':1,'collectionId':'fixed-reference-expansion-v1','status':'private-candidate-not-deployed','defaultReplacementApproved':False,'publicDeploymentApproved':False,'createdAt':now(),'voicesByLanguage':voices,'clips':clips,'eligibleContrasts':coverage,'phoneticListeningVerified':False,'speakerConsistencyVerified':False,'conditionalPairs':scoped['conditionalPairs'],'targetIPAMechanism':scoped['targetIPAMechanism'],'scopeNote':'Only the three English requested contrasts and French fr-a-an. All candidate audio remains generated and unreviewed. Existing description-based recordings are neither copied nor relabeled.'}
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',action='store_true');args=parser.parse_args();scoped=scope()
 print(json.dumps({'words':{lang:len(items)for lang,items in scoped['words'].items()},'plannedClips':46,'profiles':4,'execute':args.execute,'publicAudioChanged':False}),flush=True)
 if not args.execute:return
 for sub in['private/references','private/originals','private/rejected','clips']:(HERE/sub).mkdir(parents=True,exist_ok=True)
 existing_ps=subprocess.check_output(['ps','-axo','pid,command'],text=True)
 conflicts=[]
 for line in existing_ps.splitlines():
  if any(s in line for s in['audio_cache.py','run_pilot.py','mlx_audio.tts.generate','fixed-reference-expansion/generate.py']):
   pid=int(line.strip().split(maxsplit=1)[0])
   if pid not in{os.getpid(),os.getppid()}:conflicts.append(pid)
 if conflicts:raise RuntimeError(f'Other synthesis-related process detected; stop before loading model: {conflicts}')
 write(HERE/'scope-snapshot.json',scoped)
 catalog=read(PILOT/'references.json');refs=[]
 for key in PROFILE_ORDER:
  reference=next(r for r in catalog['references']if r['profileKey']==key).copy();source=PILOT/reference['privateWavPath'];assert sha(source)==reference['referenceSha256'];assert reference['synthetic']is True
  dest=HERE/'private/references'/source.name
  if not dest.exists():shutil.copyfile(source,dest)
  assert sha(dest)==reference['referenceSha256'];reference['privateWavPath']=str(dest.relative_to(HERE));reference['originCatalogSha256']=sha(PILOT/'references.json');refs.append(reference)
 write(HERE/'references.json',{'references':refs,'origin':'fixed-speaker-pilot accepted fictional references; no new reference generation'})
 from huggingface_hub import snapshot_download
 import mlx.core as mx,numpy as np,soundfile as sf
 from mlx_audio.tts.utils import load_model
 from mlx_audio.utils import load_audio
 versions={name:importlib.metadata.version(name)for name in['mlx-audio','mlx','numpy','soundfile','huggingface-hub']}
 started=time.perf_counter();event(stage='load-base',model=MODEL,revision=REVISION);model=load_model(snapshot_download(MODEL,revision=REVISION,local_files_only=True))
 assert model.config.tts_model_type=='base'and model.speaker_encoder is not None and model.speech_tokenizer.has_encoder
 inventory=HERE/'inventory.private.json';clips=read(inventory)['clips']if inventory.exists()else[];completed={(c['voiceId'],c['text']):c for c in clips};unavailable=[];attempts=[]
 for reference_index,ref in enumerate(refs):
  wav=HERE/ref['privateWavPath'];assert sha(wav)==ref['referenceSha256'];model._icl_cache.clear();embedding=model.extract_speaker_embedding(load_audio(str(wav),sample_rate=model.sample_rate));embedding_hash=hashed(np.asarray(embedding,dtype=np.float32).tobytes())
  assert embedding_hash==ref['baseSpeakerEmbeddingSha256'],'Reference embedding differs from accepted pilot; inspect before continuing'
  for word_index,word in enumerate(scoped['words'][ref['languageId']]):
   key=(ref['voiceId'],word['text'])
   if key in completed:
    c=completed[key];assert sha(HERE/'clips'/pathlib.Path(c['url']).name)==c['sha256']and sha(HERE/c['privateWavPath'])==c['sourceWavSha256'];continue
   for attempt in range(3):
    seed=2280000+reference_index*10000+word_index*100+attempt
    settings={'model':MODEL,'modelRevision':REVISION,'language':LANGUAGES[ref['languageId']],'text':word['text'],'referenceSha256':ref['referenceSha256'],'referenceTextSha256':ref['referenceTextSha256'],'seed':seed,'take':0,'attempt':attempt,'temperature':.65,'topP':.9,'topK':50,'repetitionPenaltyRequested':1.05,'effectiveICLRepetitionPenalty':1.5,'maxTokens':60,'runtimeVersions':versions,'encoding':'192k-mp3-original-24000hz-mono'}
    cid=hashed(json.dumps(settings,sort_keys=True,ensure_ascii=False).encode())[:28];original=HERE/'private/originals'/f'{cid}.wav'
    event(stage='word-start',voice=ref['voiceId'],word=word['text'],attempt=attempt,seed=seed);mx.random.seed(seed);tick=time.perf_counter()
    out=list(model.generate(text=word['text'],lang_code=LANGUAGES[ref['languageId']].lower(),ref_audio=str(wav),ref_text=ref['referenceText'],temperature=.65,top_p=.9,top_k=50,repetition_penalty=1.05,max_tokens=60,verbose=False,stream=False));elapsed=time.perf_counter()-tick
    record={'voiceId':ref['voiceId'],'text':word['text'],'seed':seed,'attempt':attempt,'generationSeconds':elapsed};reasons=[]
    if not out:reasons=['No waveform returned (immediate EOS)']
    else:
     data=np.concatenate([np.asarray(part.audio,dtype=np.float32)for part in out]);rate=int(out[0].sample_rate);tokens=sum(part.token_count for part in out)
     if not len(data)or not np.isfinite(data).all():reasons=['Empty or non-finite waveform']
     else:
      duration=len(data)/rate;peak=float(np.max(np.abs(data)));scale=min(1.,.98/peak)if peak else 1.;rms=float(np.sqrt(np.mean(data.astype(np.float64)**2)))
      sf.write(original,data*scale,rate,subtype='PCM_16');record.update({'durationSeconds':duration,'tokenCount':tokens})
      if not .16<=duration<=3.2:reasons.append('Duration outside0.16–3.2 seconds')
      if tokens>=60:reasons.append('Generation token cap reached')
      if rms<.00005:reasons.append('Near-silent waveform')
    if reasons:
     if original.exists():original.rename(HERE/'private/rejected'/original.name)
     record.update({'acceptedEngineering':False,'reasons':reasons});attempts.append(record);event(stage='word-rejected',**record);continue
    output=HERE/'clips'/f'{cid}.mp3';subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(original),'-map_metadata','-1','-ac','1','-c:a','libmp3lame','-b:a','192k',str(output)],check=True)
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=sample_rate,channels:format=duration','-of','json',str(output)],text=True));subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(output),'-f','null','-'],check=True,stdout=subprocess.DEVNULL);encoded_duration=float(probe['format']['duration']);assert abs(encoded_duration-duration)<.15
    c={'id':cid,'languageId':ref['languageId'],'voiceId':ref['voiceId'],**word,'take':0,'url':f'/audio/fixed-reference-expansion/clips/{cid}.mp3','status':'generated-unreviewed','provider':'qwen-base-fixed-reference','synthetic':True,'phoneticListeningVerified':False,'speakerConsistencyVerified':False,'assessmentApproved':False,'intendedLocale':ref['intendedLocale'],'intendedDialect':ref['intendedDialect'],'conditioningMechanism':CONDITIONING,'referenceSha256':ref['referenceSha256'],'referenceTextSha256':ref['referenceTextSha256'],'baseSpeakerEmbeddingSha256':embedding_hash,'referenceProvenance':ref['provenance'],'referenceRemoval':'MLX Base ICL removes its decoded reference prefix internally; no additional word trimming applied','privateReferencePath':ref['privateWavPath'],'privateWavPath':str(original.relative_to(HERE)),'model':MODEL,'modelRevision':REVISION,'modelLicense':'Apache-2.0','modelLicenseUrl':f'https://huggingface.co/{MODEL}/blob/{REVISION}/README.md','generationSettings':settings,'sha256':sha(output),'sourceWavSha256':sha(original),'bytes':output.stat().st_size,'durationSeconds':duration,'encodedDurationSeconds':encoded_duration,'sampleRate':rate,'channels':1,'samples':len(data),'peakBeforeAdjustment':peak,'peakScale':scale,'rmsBeforeAdjustment':rms,'generationTokenCount':tokens,'maxTokens':60,'generationSeconds':elapsed,'createdAt':now()}
    clips.append(c);completed[key]=c;record['acceptedEngineering']=True;attempts.append(record);write(inventory,{'clips':clips});event(stage='word-complete',voice=ref['voiceId'],word=word['text'],count=len(clips),seconds=duration,generationSeconds=elapsed);break
   else:unavailable.append({'voiceId':ref['voiceId'],'text':word['text']})
 manifest=metadata_manifest(clips,refs,scoped);write(HERE/'manifest.candidate.json',manifest)
 safe=json.loads(json.dumps(manifest))
 for c in safe['clips']:
  for k in['privateReferencePath','privateWavPath']:c.pop(k,None)
 write(HERE/'manifest.preview.json',safe)
 public_refs=json.loads(json.dumps(refs))
 for r in public_refs:r.pop('privateWavPath',None)
 write(HERE/'reference-provenance.public.json',{'references':public_refs,'transcriptStatus':'Exact supplied synthesis input, not a listening-confirmed transcript','rawReferenceAudioIncluded':False})
 write(HERE/'integration-inventory.json',{'collectionId':'fixed-reference-expansion-v1','status':'isolated-unreviewed-candidate','total':len(clips),'eligibleContrasts':manifest['eligibleContrasts'],'files':[{'path':'clips/'+pathlib.Path(c['url']).name,'url':c['url'],'languageId':c['languageId'],'text':c['text'],'voiceId':c['voiceId'],'sha256':c['sha256'],'bytes':c['bytes']}for c in clips],'excluded':['private/','raw reference WAVs','rejected files','inventory.private.json','manifest.candidate.json'],'defaultReplacementApproved':False})
 write(HERE/'run-summary.json',{'completedAt':now(),'elapsedSeconds':time.perf_counter()-started,'plannedClips':46,'clipCount':len(clips),'bytes':sum(c['bytes']for c in clips),'unavailable':unavailable,'attemptsThisInvocation':attempts,'runtimeVersions':versions,'model':MODEL,'modelRevision':REVISION,'publicAudioChanged':False,'phoneticListeningVerified':False,'speakerConsistencyVerified':False})
 event(stage='complete',clips=len(clips),unavailable=len(unavailable))
 if unavailable:raise SystemExit(2)
if __name__=='__main__':main()
