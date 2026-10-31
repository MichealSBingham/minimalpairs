#!/usr/bin/env python3
"""Independent word/profile/license/file/curriculum checks; never listening approval."""
import collections, hashlib, json, pathlib, subprocess
from datetime import datetime, timezone
import numpy as np
BASE=pathlib.Path(__file__).resolve().parent
def read(name):return json.loads((BASE/name).read_text())
def digest(path,algorithm='sha256'):return hashlib.new(algorithm,path.read_bytes()).hexdigest()
def decode(path):
 result=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),'-map','0:a:0','-f','f32le','-acodec','pcm_f32le','-'],capture_output=True)
 return result,np.frombuffer(result.stdout,dtype='<f4')
def main():
 manifest=read('manifest.candidate.json');public=read('manifest.preview.json');clips=manifest['clips'];curriculum=read('curriculum.candidate.json');credits=read('attribution.json')['records'];inventory=read('integration-inventory.json');errors=[];warnings=[];signals=[]
 def check(condition,message):
  if not condition:errors.append(message)
 check(len(clips)==8,'Exactly eight clips required')
 check({c['text']for c in clips}=={'in','ihn','im','ihm'},'Exact word set')
 check(len({(c['text'],c['voiceId'])for c in clips})==8,'Unique word/voice mappings')
 check(len({c['sha256']for c in clips})==8 and len({c['originalSha256']for c in clips})==8,'Distinct original/output hashes')
 expected_licenses={'human-de-jeuwre':'CC-BY-SA-4.0','human-de-joni':'CC-BY-SA-3.0'}
 check(set(expected_licenses)=={v['id']for v in manifest['voicesByLanguage']['de']},'Exactly two intended contributors')
 pages={p['title']:p for p in read('sources/alternate-pair-file-metadata.json')['query']['pages'].values()}
 for voice,license_id in expected_licenses.items():
  check({c['text']for c in clips if c['voiceId']==voice}=={'in','ihn','im','ihm'},voice+': complete two-pair coverage')
  category_dates={category:{c['originalUploadTimestamp'][:10]for c in clips if c['voiceId']==voice and (c['text']in{'in','im'})==(category==0)}for category in[0,1]}
  if category_dates[0].isdisjoint(category_dates[1]):warnings.append({'kind':'category-correlated-current-file-version-dates','voiceId':voice,'shortVowelDates':sorted(category_dates[0]),'longVowelDates':sorted(category_dates[1]),'limitation':'Metadata association only; actual recording session and audible artifact differences unreviewed.'})
 for c in clips:
  key=c['voiceId']+'/'+c['text'];page=pages[c['sourceTitle']];info=page['imageinfo'][0];mp3=BASE/'clips'/pathlib.Path(c['url']).name;original=BASE/c['originalPrivatePath']
  check(digest(mp3)==c['sha256']and mp3.stat().st_size==c['bytes'],key+': MP3 hash/size')
  check(digest(original)==c['originalSha256']and digest(original,'sha1')==info['sha1']==c['sourceSha1'],key+': source hash')
  check(original.stat().st_size==info['size'],key+': source size')
  check(c['sourceRevisionId']==page['revisions'][0]['revid'],key+': source revision')
  check(c['license']['id']==expected_licenses[c['voiceId']],key+': exact per-file license')
  check(c['license']['shareAlike']is True and c['license']['attributionRequired']is True,key+': license obligations')
  check(c['synthetic']is False and c['status']=='source-verified-unreviewed',key+': source/review label')
  check(c['phoneticListeningVerified']is False and c['speakerConsistencyVerified']is False,key+': no unearned review')
  check(c['sourceTranscription']==c['text']and c['sourceTranscriptionEvidence']['text']==c['text'],key+': source word evidence')
  probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_name,sample_rate,channels:format=duration','-of','json',str(mp3)],text=True))
  check(len(probe['streams'])==1 and probe['streams'][0]['codec_name']=='mp3'and probe['streams'][0]['sample_rate']=='44100'and probe['streams'][0]['channels']==1,key+': encoded format')
  check(abs(float(probe['format']['duration'])-c['sourceDurationSeconds'])<.1,key+': source/output duration')
  results=[]
  for label,path in[('original',original),('mp3',mp3)]:
   result,data=decode(path);check(result.returncode==0 and not result.stderr,key+': '+label+' decode');check(len(data)>0 and np.isfinite(data).all(),key+': '+label+' finite nonempty samples')
   rms=float(np.sqrt(np.mean(data.astype(np.float64)**2)))if len(data)else 0
   peak=float(np.max(np.abs(data)))if len(data)else 0
   check(rms>1e-7,key+': '+label+' non-silent waveform');results.append({'format':label,'decodedSamples':len(data),'rms':rms,'peak':peak})
  signals.append({'voiceId':c['voiceId'],'text':c['text'],'signals':results})
  matching=[r for r in credits if r['voiceId']==c['voiceId']and r['text']==c['text']]
  check(len(matching)==1 and matching[0]['license']==c['license']['id']and matching[0]['sourceRevision']==c['sourceRevision']and matching[0]['changes']==c['changes'],key+': attribution matches')
 contrast=curriculum['languages'][0]['contrasts'][0];pairs=contrast['pairs']
 check(contrast['id']=='de-i-length-pronouns'and len(pairs)==2,'Isolated two-pair curriculum scope')
 check([p['id']for p in pairs]==['de-in-ihn','de-im-ihm'],'Exact pair IDs')
 for pair in pairs:
  short,long=pair['words'];index=pair['abx']['targetTokenIndex']
  check(index==0 and short['phonemes'][index]=='ɪ'and long['phonemes'][index]=='iː',pair['id']+': category alignment')
  check(short['phonemes'][1:]==long['phonemes'][1:]and short['phonemes']!=long['phonemes'],pair['id']+': exactly one broad phonemic difference')
  for word in pair['words']:
   check(word['ipa']=='/'+''.join(word['phonemes'])+'/',pair['id']+': IPA/token alignment')
   check(all(c['targetIPA']==word['ipa']for c in clips if c['text']==word['text']),pair['id']+': recorded target metadata aligns')
 check(set(w['text']for w in pairs[0]['words']).isdisjoint(w['text']for w in pairs[1]['words']),'Cross-word reference/X pairs must not share words')
 check(manifest['eligibleContrasts'][0]['pairCount']==2 and manifest['eligibleContrasts'][0]['pairIds']==[p['id']for p in pairs],'Manifest/curriculum scope matches')
 safe=json.loads(json.dumps(manifest))
 for c in safe['clips']:c.pop('originalPrivatePath',None)
 check(safe==public,'Public-safe manifest differs only by removed private path')
 check('private/'not in(BASE/'manifest.preview.json').read_text()and'/Users/'not in(BASE/'manifest.preview.json').read_text(),'Public manifest private-path leak')
 check({f['sha256']for f in inventory['files']}=={c['sha256']for c in clips},'Integration file selection')
 check(len(list((BASE/'clips').glob('*')))==8,'Only selected eight assets in clips folder')
 result={'checkedAt':datetime.now(timezone.utc).isoformat(),'status':'engineering-pass'if not errors else'engineering-fail','pairCount':2,'wordCount':4,'contributors':2,'clips':8,'bytes':sum(c['bytes']for c in clips),'sourceLicenses':dict(collections.Counter(c['license']['id']for c in clips)),'durationSeconds':{'min':min(c['durationSeconds']for c in clips),'max':max(c['durationSeconds']for c in clips)},'errors':errors,'warnings':warnings,'signalMeasurements':signals,'phoneticListeningVerified':False,'speakerConsistencyVerified':False,'mainCurriculumEdited':False,'publicAudioChanged':False}
 (BASE/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:v for k,v in result.items()if k!='signalMeasurements'},ensure_ascii=False,indent=2));raise SystemExit(bool(errors))
if __name__=='__main__':main()
