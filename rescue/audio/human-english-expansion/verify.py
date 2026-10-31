#!/usr/bin/env python3
"""Verify engineering/provenance consistency without making a listening judgment."""
import collections,hashlib,json,pathlib,subprocess
from datetime import datetime,timezone
BASE=pathlib.Path(__file__).resolve().parent
def read(name):return json.loads((BASE/name).read_text())
def digest(path,algo='sha256'):return hashlib.new(algo,path.read_bytes()).hexdigest()
def main():
 m=read('manifest.candidate.json');cs=m['clips'];errors=[];warnings=[]
 def check(condition,msg):
  if not condition:errors.append(msg)
 check(len(cs)==12,'Expected twelve clips')
 voices={v['id']:v for v in m['voicesByLanguage']['en']};check(len(voices)==2,'Expected two voices')
 for voice in voices:check({c['text']for c in cs if c['voiceId']==voice}=={'cat','cut','cap','cup','lack','luck'},f'{voice}: complete six-word set required')
 hashes=[]
 for c in cs:
  path=BASE/'clips'/pathlib.Path(c['url']).name;original=BASE/c['originalPrivatePath'];k=c['voiceId']+'/'+c['text']
  check(digest(path)==c['sha256']and path.stat().st_size==c['bytes'],k+': output hash/size')
  check(digest(original)==c['originalSha256']and digest(original,'sha1')==c['sourceSha1'],k+': original hashes')
  result=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),'-f','null','-'],capture_output=True,text=True)
  check(result.returncode==0 and not result.stderr,k+': decode errors')
  p=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=sample_rate,channels:format=duration','-of','json',str(path)],text=True))
  check(len(p['streams'])==1 and p['streams'][0]['sample_rate']=='44100'and p['streams'][0]['channels']==1,k+': format')
  duration=float(p['format']['duration']);check(.1<duration<5,k+': duration outside broad isolation bounds')
  if duration>2:warnings.append(k+': unusually long isolated-word recording; prioritize listening')
  check(c['sourceTranscription']==c['text']==c['sourceTranscriptionEvidence']['text'],k+': source word mismatch')
  check(c['license']['id']==voices[c['voiceId']]['licenseId'],k+': per-file license mismatch')
  check(c['synthetic']is False and c['status']=='source-verified-unreviewed'and c['phoneticListeningVerified']is False,k+': review status')
  hashes.append(c['sha256'])
 check(len(set(hashes))==12,'Duplicated encoded waveform')
 check(len({(c['text'],c['voiceId'])for c in cs})==12,'Duplicated word/profile mapping')
 attr={(c['voiceId'],c['text']):c for c in read('attribution.json')['records']}
 for c in cs:
  a=attr[(c['voiceId'],c['text'])]
  for field,source in [('author','author'),('sourcePage','sourcePage'),('sourceRevision','sourceRevision'),('changes','changes'),('additionalAttribution','additionalAttribution'),('originalLicenseNotice','originalLicenseNotice')]:check(a[field]==c[source],f'{c["text"]}: lost attribution {field}')
  check(a['license']==c['license']['id']and a['licenseUrl']==c['license']['url'],'Lost license')
 result={'checkedAt':datetime.now(timezone.utc).isoformat(),'status':'engineering-pass'if not errors else'engineering-fail','clips':len(cs),'contributors':len(voices),'matchedPairs':3,'completeRequestedContrasts':1,'requestedContrasts':3,'distinctRequestedWordsAcquired':6,'requestedDistinctWords':17,'bytes':sum(c['bytes']for c in cs),'distinctHashes':len(set(hashes)),'durationSeconds':{'min':min(c['durationSeconds']for c in cs),'max':max(c['durationSeconds']for c in cs)},'perFileLicenseCounts':dict(collections.Counter(c['license']['id']for c in cs)),'errors':errors,'warnings':warnings,'generalAmericanEvidenceCompleteForBothProfiles':False,'phoneticListeningVerified':False,'speakerConsistencyVerified':False,'publicAudioChanged':False}
 (BASE/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False,indent=2))
 pairs={word:(pid,ipa)for pid,words in [('en-cat-cut',[('cat','/kæt/'),('cut','/kʌt/')]),('en-cap-cup',[('cap','/kæp/'),('cup','/kʌp/')]),('en-lack-luck',[('lack','/læk/'),('luck','/lʌk/')])]for word,ipa in words}
 review={'status':'not-listened','reviewer':None,'reviewerLanguageExperience':None,'instructions':['Listen to the whole file; write what you hear before consulting the target.','Check the vowel category and intact consonants, not merely pleasantness.','Compare all six words within each credited profile for audible identity and recording artifacts.','Separately assess General American suitability; one profile has no explicit regional source evidence.','Do not promote an uncertain or failed required word as a complete contrast.'],'phoneticListeningVerified':False,'clips':[{'id':c['id'],'path':'clips/'+pathlib.Path(c['url']).name,'voiceId':c['voiceId'],'requestedWord':c['text'],'targetIPA':pairs[c['text']][1],'pairId':pairs[c['text']][0],'heardWord':None,'wordMatch':'not-reviewed','targetContrast':'not-reviewed','generalAmericanSuitability':'not-reviewed','speakerConsistency':'not-reviewed','artifacts':None,'decision':'not-reviewed','notes':None}for c in cs]}
 (BASE/'listening-review.template.json').write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n')
 raise SystemExit(bool(errors))
if __name__=='__main__':main()
