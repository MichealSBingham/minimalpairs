#!/usr/bin/env python3
"""Independent candidate coverage/file/conditioning checks; no acoustic approval."""
import hashlib,json,pathlib,statistics,subprocess
from datetime import datetime,timezone
import numpy as np,soundfile as sf
HERE=pathlib.Path(__file__).resolve().parent
EXPECTED={'en':{'lesion','legion','pleasure','pledger','version','virgin','put','putt','look','luck','book','buck','cat','cut','cap','cup','lack'},'fr':{'chat','chant','rat','rang','plat','plan'}}
CONTRASTS={'en-zh-j':{'lesion','legion','pleasure','pledger','version','virgin'},'en-foot-strut':{'put','putt','look','luck','book','buck'},'en-ae-strut':{'cat','cut','cap','cup','lack','luck'},'fr-a-an':{'chat','chant','rat','rang','plat','plan'}}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(n):return json.loads((HERE/n).read_text())
def main():
 manifest=read('manifest.candidate.json');preview=read('manifest.preview.json');clips=manifest['clips'];refs=read('references.json')['references'];catalog=json.loads((HERE.parent/'fixed-speaker-pilot/references.json').read_text())['references'];errors=[];warnings=[]
 def check(condition,msg):
  if not condition:errors.append(msg)
 check(len(clips)==46,'Expected46 primary clips')
 check(len({(c['languageId'],c['text'],c['voiceId'])for c in clips})==len(clips),'Duplicate word/profile mappings')
 check(len({c['sha256']for c in clips})==len(clips),'Duplicate encoded waveforms')
 check(len({c['sourceWavSha256']for c in clips})==len(clips),'Duplicate original waveforms')
 check(len(refs)==4 and len({r['referenceSha256']for r in refs})==4,'Four distinct accepted references required')
 for ref in refs:
  old=next(r for r in catalog if r['voiceId']==ref['voiceId'])
  for field in['referenceSha256','referenceTextSha256','referenceText','baseSpeakerEmbeddingSha256','seed','referenceModel','referenceModelRevision']:check(ref[field]==old[field],f'{ref["profileKey"]}: reference {field} changed')
  check(sha(HERE/ref['privateWavPath'])==ref['referenceSha256'],f'{ref["profileKey"]}: copied reference hash')
  check(hashlib.sha256(ref['referenceText'].encode()).hexdigest()==ref['referenceTextSha256'],f'{ref["profileKey"]}: supplied transcript hash')
  matched=[c for c in clips if c['voiceId']==ref['voiceId']]
  check({c['text']for c in matched}==EXPECTED[ref['languageId']],f'{ref["profileKey"]}: exact word coverage')
 for c in clips:
  key=f'{c["voiceId"]}/{c["text"]}';ref=next(r for r in refs if r['voiceId']==c['voiceId']);mp3=HERE/'clips'/pathlib.Path(c['url']).name;wav=HERE/c['privateWavPath']
  check(sha(mp3)==c['sha256']and mp3.stat().st_size==c['bytes'],key+': encoded hash/size')
  check(sha(wav)==c['sourceWavSha256'],key+': original hash')
  data,rate=sf.read(wav);check(data.ndim==1 and np.isfinite(data).all()and rate==24000,key+': source format/finite')
  check(float(np.sqrt(np.mean(data.astype(np.float64)**2)))>=.00005,key+': near-silent source')
  check(.16<=len(data)/rate<=3.2 and np.max(np.abs(data))>0,key+': source duration/silence')
  result=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(mp3),'-f','null','-'],capture_output=True,text=True);check(result.returncode==0 and not result.stderr,key+': decode')
  p=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=sample_rate,channels:format=duration','-of','json',str(mp3)],text=True));check(len(p['streams'])==1 and p['streams'][0]['sample_rate']=='24000'and p['streams'][0]['channels']==1,key+': MP3 format')
  check(abs(float(p['format']['duration'])-len(data)/rate)<.15,key+': duration discrepancy')
  for field in['referenceSha256','referenceTextSha256','baseSpeakerEmbeddingSha256']:check(c[field]==ref[field],key+': conditioning '+field)
  check(c['take']==0 and c['synthetic']is True and c['status']=='generated-unreviewed',key+': source/review label')
  check(c['phoneticListeningVerified']is False and c['speakerConsistencyVerified']is False and c['assessmentApproved']is False,key+': unearned approval')
  is_repair=c['text']=='lesion' and c['voiceId']=='qwen-fixed-en-b-fc29c14c'
  if is_repair:
   check(c['ttsText']=='Lesion.' and c['generationSettings']['text']=='Lesion.' and c['generationSettings']['intendedWord']=='lesion',key+': repair input not exact permitted capitalization/punctuation')
   check(c['generationSettings']['attemptSeries']=='lesion-capitalization-punctuation-repair' and c['generationSettings']['attempt']<2,key+': repair attempt bounds')
  else:check(c['generationSettings']['text']==c['text'],key+': generation spelling changed')
  check(c['generationTokenCount']<60 and c['generationSettings']['attempt']<3,key+': generation bounds')
  check(c['model']=='mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit' and c['modelRevision']=='0d6bb6fe33f92d47a507e23b9148940e8366ab5b',key+': pinned model')
  check(c['conditionalReadingRequired']==(c['text']in{'version','virgin','rat'}),key+': conditional reading flag')
  if c['durationSeconds']>2:warnings.append({'kind':'long-word-listening-review','voiceId':c['voiceId'],'text':c['text'],'durationSeconds':c['durationSeconds']})
 check({s['contrastId']for s in manifest['eligibleContrasts']}==set(CONTRASTS),'Unexpected contrast scope')
 for scope in manifest['eligibleContrasts']:
  words={w for p in scope['pairs']for w in p['words']};check(words==CONTRASTS[scope['contrastId']],scope['contrastId']+': scope words')
  check(scope['completeForListedPairs']is True and not scope['missing'],scope['contrastId']+': incomplete coverage')
  check(len(scope['pairIds'])==3,scope['contrastId']+': expectedthree pairs')
  check(scope['phoneticListeningVerified']is False and scope['assessmentApproved']is False,scope['contrastId']+': review claim')
 public=json.loads(json.dumps(manifest))
 for c in public['clips']:
  c.pop('privateWavPath',None);c.pop('privateReferencePath',None)
 check(public==preview,'Preview differs beyond removed private paths')
 for filename in['manifest.preview.json','reference-provenance.public.json']:
  text=(HERE/filename).read_text();check('private/'not in text and '/Users/'not in text,filename+': private path leak')
 inventory=read('integration-inventory.json');check(inventory['total']==46 and len(inventory['files'])==46,'Integration inventory count')
 check({f['sha256']for f in inventory['files']}=={c['sha256']for c in clips},'Integration inventory differs')
 complete=read('manifest.complete-scopes.preview.json')
 check(len(complete['clips'])==46 and not complete['withheldScopes'],'Complete-scope preview differs from final complete coverage')
 check({c['sha256']for c in complete['clips']}=={c['sha256']for c in clips},'Complete-scope file selection differs')
 repair=read('repair-lesion-result.json');check(repair['completed']is True and repair['accepted']is True and len(repair['attempts'])<=2,'Bounded repair status/attempt count')
 check(repair['originalTtsText']=='lesion' and repair['ttsText']=='Lesion.','Bounded repair text provenance')
 times=[c['generationSeconds']for c in clips];summary=read('run-summary.json')
 result={'checkedAt':datetime.now(timezone.utc).isoformat(),'status':'engineering-pass'if not errors else'engineering-fail','clips':len(clips),'bytes':sum(c['bytes']for c in clips),'languages':{lang:{'distinctWords':len({c['text']for c in clips if c['languageId']==lang}),'clips':sum(c['languageId']==lang for c in clips),'voiceProfiles':sum(r['languageId']==lang for r in refs)}for lang in EXPECTED},'completeSourceScopes':[s['contrastId']for s in manifest['eligibleContrasts']if s['completeForListedPairs']],'distinctEncodedHashes':len({c['sha256']for c in clips}),'durationSeconds':{'min':min(c['durationSeconds']for c in clips),'max':max(c['durationSeconds']for c in clips)},'acceptedGenerationSeconds':{'min':min(times),'median':statistics.median(times),'max':max(times),'total':sum(times)},'rejectedAttempts':sum(not a['acceptedEngineering']for a in summary.get('allAttempts',summary['attemptsThisInvocation'])),'missing':summary['unavailable'],'errors':errors,'warnings':warnings,'phoneticListeningVerified':False,'speakerConsistencyVerified':False,'publicAudioChanged':False}
 (HERE/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(bool(errors))
if __name__=='__main__':main()
