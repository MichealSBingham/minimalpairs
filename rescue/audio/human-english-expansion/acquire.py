#!/usr/bin/env python3
"""Acquire the complete source-identified TRAP/STRUT candidate; never publish it."""
import hashlib,html,json,os,pathlib,re,shutil,subprocess,time,urllib.parse
from datetime import datetime,timezone
from discover import BASE,request,write
WORDS=['cat','cut','cap','cup','lack','luck']
SPEAKERS=[
 {'id':'human-en-grendelkhan','name':'Grendelkhan','prefix':'File:LL-Q1860 (eng)-Grendelkhan-','extension':'.wav','licenseId':'CC0-1.0','licenseName':'CC0','licenseUrl':'https://creativecommons.org/publicdomain/zero/1.0/','locale':'en','sourceProject':'Lingua Libre','speakerEntity':'https://lingualibre.org/wiki/Q929501','speakerSource':'https://commons.wikimedia.org/wiki/User:Grendelkhan','dialectSourceStatus':'region-unestablished','description':'Human recording; native English self-declaration; regional accent unreviewed','localeEvidence':'Commons profile declares native English. Exact file metadata identifies English and this contributor; no regional accent declaration was established. General American suitability requires listening.'},
 {'id':'human-en-dvortygirl','name':'Dvortygirl','prefix':'File:En-us-','extension':'.ogg','licenseId':'CC-BY-SA-3.0','licenseName':'CC BY-SA 3.0','licenseUrl':'https://creativecommons.org/licenses/by-sa/3.0/','locale':'en-US','sourceProject':'Wikimedia Commons / Wiktionary','speakerSource':'https://commons.wikimedia.org/wiki/User:Dvortygirl','dialectSourceStatus':'source-identifies-US-English','description':'Human recording; US English source evidence; pronunciation unreviewed','localeEvidence':'Exact Commons file pages identify US English. Wiktionary labels cat/cup/lack GA and cap/cut/luck US. Public profiles declare native English. Source labels are not an independent listening verdict.'}
]
def digest(path,algo='sha256'):return hashlib.new(algo,path.read_bytes()).hexdigest()
def clean(text):return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',text))).strip()
def probe(path):return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_name,sample_rate,channels:stream_tags:format=duration:format_tags','-of','json',str(path)],text=True))
def selected_sources():
 pages={}
 for filename in ['lingualibre-candidate-metadata.json','legacy-metadata.json']:
  pages.update({p['title']:p for p in json.loads((BASE/'sources'/filename).read_text())['query']['pages'].values()})
 entities=json.loads((BASE/'sources/lingualibre-candidate-mediainfo.json').read_text())['entities']
 entries={p['title']:p for p in json.loads((BASE/'sources/wiktionary-entry-pronunciations.json').read_text())['query']['pages'].values()}
 selected=[]
 for speaker in SPEAKERS:
  for word in WORDS:
   title=speaker['prefix']+word+speaker['extension'];page=pages[title];info=page['imageinfo'][0];ext=info['extmetadata'];wiki=page['revisions'][0]['slots']['main']['*']
   assert ext['LicenseShortName']['value']==speaker['licenseName']
   assert speaker['name']in ext['Artist']['value']
   if speaker['name']=='Grendelkhan':
    assert '{{cc-zero}}'in wiki and 'Q929501'in ext['Artist']['value']
    entity=entities['M'+str(page['pageid'])];transcription=entity['statements']['P9533'][0]['mainsnak']['datavalue']['value']
    assert transcription=={'text':word,'language':'en'}
    evidence={'kind':'Commons MediaInfo exact spoken-text statement P9533','text':word,'language':'en','entityId':entity['id'],'revisionId':entity['lastrevid']}
    pronunciation_evidence=None
   else:
    assert 'Cc-by-sa-3.0-migrated'in wiki or '{{GFDL|migration=relicense}}'in wiki
    comment=info['comment'];description=clean(ext['ImageDescription']['value'])
    assert ('US English'in description or 'United States English'in description)
    if word=='lack':assert "term 'lack'"in description;evidence={'kind':'Literal word in current file description','text':word,'description':description}
    else:
     assert f'[[Category:English pronunciation|{word}]]'in comment and 'recorded by [[User:Dvortygirl|Dvortygirl]]'in comment
     evidence={'kind':'Original/current audio upload description identifies exact term and recorder','text':word,'uploadComment':comment,'uploadTimestamp':info['timestamp']}
    entry=entries[word];lines=[line for line in entry['revisions'][0]['slots']['main']['*'].splitlines()if '{{audio|en|'in line and title[5:].lower()in line.lower()]
    assert len(lines)==1 and any(a in lines[0]for a in['a=GA','a=US'])
    pronunciation_evidence={'source':'English Wiktionary','page':'https://en.wiktionary.org/wiki/'+word,'revisionId':entry['revisions'][0]['revid'],'audioDeclaration':lines[0],'limitation':'Source accent label only; actual pronunciation not listening-verified'}
   selected.append((speaker,word,page,evidence,pronunciation_evidence))
 return selected
def main():
 selected=selected_sources()
 originals=BASE/'private/originals';originals.mkdir(parents=True,exist_ok=True);os.chmod(BASE/'private',0o700);os.chmod(originals,0o700)
 (BASE/'clips').mkdir(exist_ok=True)
 shutil.copyfile(BASE.parent/'human-english-pilot/sources/public-speaker-profiles.json',BASE/'sources/previously-audited-speaker-profiles.json')
 clips=[]
 for speaker,word,page,evidence,pronunciation_evidence in selected:
  info=page['imageinfo'][0];ext=info['extmetadata'];assert info['size']<2000000
  original=originals/(speaker['id']+'-'+word+speaker['extension'])
  if not original.exists():
   parts=urllib.parse.urlsplit(info['url']);assert parts.scheme=='https'and parts.hostname=='upload.wikimedia.org'
   original.write_bytes(request(urllib.parse.urlunsplit((parts.scheme,parts.netloc,parts.path,'','')),maxbytes=2000000));os.chmod(original,0o600);time.sleep(6)
  assert original.stat().st_size==info['size']and digest(original,'sha1')==info['sha1']
  original_probe=probe(original);s=original_probe['streams'][0]
  tags={k.upper():v.strip()for k,v in {**s.get('tags',{}),**original_probe.get('format',{}).get('tags',{})}.items()}
  if tags.get('SWAC_TEXT'):assert tags['SWAC_TEXT']==word
  if tags.get('TITLE'):assert tags['TITLE'].lower()==word
  filename=hashlib.sha256((digest(original)+'|mp3-libmp3lame-192k-44100hz-mono-v1').encode()).hexdigest()[:24]+'.mp3';output=BASE/'clips'/filename
  if not output.exists():subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(original),'-map','0:a:0','-map_metadata','-1','-ar','44100','-ac','1','-c:a','libmp3lame','-b:a','192k',str(output)],check=True)
  encoded=probe(output);subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(output),'-f','null','-'],check=True,stdout=subprocess.DEVNULL)
  assert encoded['streams'][0]['sample_rate']=='44100'and encoded['streams'][0]['channels']==1
  assert abs(float(original_probe['format']['duration'])-float(encoded['format']['duration']))<.1
  revision=page['revisions'][0];source_page='https://commons.wikimedia.org/wiki/'+urllib.parse.quote(page['title'].replace(' ','_'),safe=':()')
  changes=f'Encoded original {s["codec_name"]} ({s["sample_rate"]} Hz, {s["channels"]} channel(s)) to 192 kbps 44.1 kHz mono MP3. Resampled/downmixed only where needed; metadata stripped. No trimming, denoising, pitch shift, time stretch or loudness normalization. Downmix can change channel balance; MP3 duration includes encoder padding.'
  c={'id':filename[:-4],'languageId':'en','text':word,'voiceId':speaker['id'],'url':'/audio/human-en-ae-strut/clips/'+filename,'status':'source-verified-unreviewed','provider':'wikimedia-commons','synthetic':False,'speaker':speaker['name'],'author':speaker['name'],'speakerAttribution':clean(ext['Artist']['value']),'locale':speaker['locale'],'targetLocale':'en-US','dialectSourceStatus':speaker['dialectSourceStatus'],'sourceTitle':page['title'],'sourceTranscription':word,'sourceTranscriptionEvidence':evidence,'pronunciationSourceEvidence':pronunciation_evidence,'sourcePage':source_page,'sourceRevision':'https://commons.wikimedia.org/w/index.php?'+urllib.parse.urlencode({'title':page['title'],'oldid':revision['revid']}),'sourceRevisionId':revision['revid'],'sourceRevisionTimestamp':revision['timestamp'],'originalUrl':info['url'],'originalUploadTimestamp':info['timestamp'],'originalRecordingDate':clean(ext.get('DateTimeOriginal',{}).get('value','')),'originalCopyrightNotice':tags.get('COPYRIGHT',''),'originalLicenseNotice':tags.get('LICENSE',''),'additionalAttribution':tags['ARTIST']if tags.get('ARTIST')and tags['ARTIST']!=speaker['name']else'','sourceSpeakerMetadata':{k:tags[k]for k in['SWAC_TEXT','SWAC_SPEAK_NAME','SWAC_SPEAK_LANG','SWAC_SPEAK_LANG_COUNTRY','SWAC_SPEAK_LANG_REGION','ARTIST','TITLE']if k in tags},'sourceProject':speaker['sourceProject'],'sourceCredit':clean(ext.get('Credit',{}).get('value','')),'license':{'id':speaker['licenseId'],'url':speaker['licenseUrl'],'attributionRequired':speaker['licenseId']!='CC0-1.0','commercialReusePermitted':True,'shareAlike':speaker['licenseId']=='CC-BY-SA-3.0'},'licenseEvidenceStatus':'exact-file-page-compiled-license-and-template-checked','sourceSha1':info['sha1'],'originalSha256':digest(original),'sha256':digest(output),'bytes':output.stat().st_size,'durationSeconds':float(encoded['format']['duration']),'sampleRate':44100,'channels':1,'originalSampleRate':int(s['sample_rate']),'originalChannels':s['channels'],'changes':changes,'phoneticListeningVerified':False,'speakerConsistencyVerified':False,'speakerIdentityStatus':'credited-by-source; not independently identity-verified','originalPrivatePath':str(original.relative_to(BASE))}
  clips.append(c);write(BASE/'acquisition-progress.json',{'clips':clips,'publicAudioChanged':False});print(json.dumps({'acquired':len(clips),'of':12,'speaker':speaker['name'],'word':word}),flush=True)
 voices=[{**{k:v for k,v in s.items()if k not in['prefix','extension','licenseName']},'source':'human-recording'}for s in SPEAKERS]
 manifest={'schemaVersion':1,'createdAt':datetime.now(timezone.utc).isoformat(),'status':'private-candidate-not-deployed','publicDeploymentApproved':False,'defaultReplacementApproved':False,'phoneticListeningVerified':False,'speakerConsistencyVerified':False,'voicesByLanguage':{'en':voices},'clips':clips,'eligibleContrasts':[{'languageId':'en','contrastId':'en-ae-strut','pairIds':['en-cat-cut','en-cap-cup','en-lack-luck'],'completeForListedPairs':True,'completeForEntireContrast':True,'generalAmericanEvidenceCompleteForBothProfiles':False,'phoneticListeningVerified':False}],'scopeNote':'Only the three-pair TRAP/STRUT set is complete in source-identified words and licenses. Dvortygirl has US/GA source evidence; Grendelkhan regional accent remains unestablished. Actual pronunciation, accent and recording quality are unreviewed. Other requested contrasts are not supplied.'}
 write(BASE/'manifest.candidate.json',manifest)
 records=[{'text':c['text'],'voiceId':c['voiceId'],'author':c['author'],'title':c['sourceTitle'],'sourcePage':c['sourcePage'],'sourceRevision':c['sourceRevision'],'license':c['license']['id'],'licenseUrl':c['license']['url'],'changes':c['changes'],'sourceProject':c['sourceProject'],'copyrightNotice':c['originalCopyrightNotice'],'additionalAttribution':c['additionalAttribution'],'originalLicenseNotice':c['originalLicenseNotice']}for c in clips]
 write(BASE/'attribution.json',{'scope':'Only these 12 English TRAP/STRUT candidate clips; license applies per file','records':records})
 print(json.dumps({'complete':True,'clips':len(clips),'bytes':sum(c['bytes']for c in clips),'phoneticListeningVerified':False,'publicAudioChanged':False}))
if __name__=='__main__':main()
