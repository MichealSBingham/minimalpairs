#!/usr/bin/env python3
"""Acquire only the authorized two-pair German human candidate; never publish."""
import hashlib, html, json, os, pathlib, re, subprocess, time, unicodedata, urllib.parse
from datetime import datetime, timezone
from discover import BASE, request, write

WORDS=['in','ihn','im','ihm']
SPEAKERS=[
 {'id':'human-de-jeuwre','name':'Jeuwre','suffix':'2','licenseId':'CC-BY-SA-4.0','licenseName':'CC BY-SA 4.0','licenseUrl':'https://creativecommons.org/licenses/by-sa/4.0/','locale':'de-DE','source':'human-recording','speakerSource':'https://commons.wikimedia.org/wiki/User:Jeuwre','dialectSourceStatus':'source-declares-native-German-from-Berlin','description':'Human recording; source declares a native German speaker from Berlin. Pronunciation and audible consistency unreviewed.'},
 {'id':'human-de-joni','name':'joni','suffix':'','licenseId':'CC-BY-SA-3.0','licenseName':'CC BY-SA 3.0','licenseUrl':'https://creativecommons.org/licenses/by-sa/3.0/','locale':'de','source':'human-recording','speakerSource':'https://de.wiktionary.org/wiki/Benutzer:Joni~dewiktionary','dialectSourceStatus':'native-and-regional-status-unestablished','description':'German pronunciation recording credited to joni. Native/regional accent and audible consistency unreviewed.'},
]
def digest(path,algorithm='sha256'):return hashlib.new(algorithm,path.read_bytes()).hexdigest()
def clean(text):return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',text))).strip()
def probe(path):return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_name,sample_rate,channels:stream_tags:format=duration:format_tags','-of','json',str(path)],text=True))
def german_section(wiki):
 parts=re.split(r'(?m)(^==[^=].*?==\s*$)',wiki)
 return '\n'.join(parts[i]+parts[i+1]for i in range(1,len(parts)-1,2)if'{{Sprache|Deutsch}}'in parts[i])
def source_data():
 pages={p['title']:p for p in json.loads((BASE/'sources/alternate-pair-file-metadata.json').read_text())['query']['pages'].values()}
 entries={p['title']:p for p in json.loads((BASE/'sources/alternate-pair-german-dictionary.json').read_text())['query']['pages'].values()}
 ipas={'in':'ɪn','ihn':'iːn','im':'ɪm','ihm':'iːm'}
 selected=[]
 for speaker in SPEAKERS:
  for word in WORDS:
   title='File:De-'+word+speaker['suffix']+'.ogg';page=pages[title];info=page['imageinfo'][0];ext=info['extmetadata'];wiki=page['revisions'][0]['slots']['main']['*']
   assert ext['LicenseShortName']['value']==speaker['licenseName']
   assert speaker['name'].lower()in clean(ext['Artist']['value']).lower()
   assert ext.get('Restrictions',{}).get('value','')==''
   assert '{{own}}'in wiki.lower()
   entry=entries[word];section=german_section(entry['revisions'][0]['slots']['main']['*']);assert section and '{{Lautschrift|'+ipas[word]+'}}'in section
   audio_names=[unicodedata.normalize('NFC',''.join(ch for ch in name if unicodedata.category(ch)!='Cf')).strip() for name in re.findall(r'\{\{Audio\|([^|}]+)',section,re.I)]
   assert title[5:].lower()in[name.lower()for name in audio_names]
   if speaker['name']=='Jeuwre':
    assert 'cc-by-sa-4.0'in wiki.lower()and'native German speaker from Berlin, Germany'in wiki
    transcription=re.search(r'(?im)^\s*\|transcription\s*=\s*(.*?)\s*$',wiki)
    if transcription:assert transcription.group(1)==word;word_evidence={'kind':'Explicit file transcription field','text':word,'sourceLine':transcription.group(0).strip()}
    else:
     description=clean(ext.get('ImageDescription',{}).get('value',''));assert '"'+word+'"'in description
     word_evidence={'kind':'Literal word in exact file description','text':word,'description':description}
   else:
    assert '{{GFDL|migration=relicense}}'in wiki
    assert re.search(r'\[\[Category:German pronunciation of [^\]|]+\|'+word+r'\]\]',wiki)
    assert info['user']=='Joni~commonswiki'
    word_evidence={'kind':'German dictionary exact-word audio link plus exact file German pronunciation category sort key and own-work creator credit','text':word,'dictionaryTitle':entry['title'],'dictionaryRevisionId':entry['revisions'][0]['revid'],'sourceCategoryLines':[l for l in wiki.splitlines()if'[[Category:German pronunciation'in l]}
   selected.append((speaker,word,page,entry,word_evidence,ipas[word]))
 return selected
def main():
 selected=source_data();originals=BASE/'private/originals';originals.mkdir(parents=True,exist_ok=True);os.chmod(BASE/'private',0o700);os.chmod(originals,0o700);(BASE/'clips').mkdir(exist_ok=True)
 clips=[]
 for speaker,word,page,entry,evidence,ipa in selected:
  info=page['imageinfo'][0];ext=info['extmetadata'];assert info['size']<2000000
  original=originals/(speaker['id']+'-'+word+'.ogg')
  if not original.exists():
   url=urllib.parse.urlsplit(info['url']);assert url.scheme=='https'and url.hostname=='upload.wikimedia.org'
   original.write_bytes(request(urllib.parse.urlunsplit((url.scheme,url.netloc,url.path,'','')),2000000));os.chmod(original,0o600);time.sleep(8)
  assert original.stat().st_size==info['size']and digest(original,'sha1')==info['sha1']
  p=probe(original);s=p['streams'][0];tags={k.upper():v.strip()for k,v in{**s.get('tags',{}),**p.get('format',{}).get('tags',{})}.items()}
  if tags.get('SWAC_TEXT'):assert tags['SWAC_TEXT']==word
  filename=hashlib.sha256((digest(original)+'|mp3-libmp3lame-192k-44100hz-mono-v1').encode()).hexdigest()[:24]+'.mp3';output=BASE/'clips'/filename
  if not output.exists():subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(original),'-map','0:a:0','-map_metadata','-1','-ar','44100','-ac','1','-c:a','libmp3lame','-b:a','192k',str(output)],check=True)
  ep=probe(output);subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(output),'-f','null','-'],check=True,stdout=subprocess.DEVNULL)
  assert ep['streams'][0]['sample_rate']=='44100'and ep['streams'][0]['channels']==1
  assert abs(float(p['format']['duration'])-float(ep['format']['duration']))<.1
  revision=page['revisions'][0];source_page='https://commons.wikimedia.org/wiki/'+urllib.parse.quote(page['title'].replace(' ','_'),safe=':()')
  changes=f'Encoded original {s["codec_name"]} ({s["sample_rate"]} Hz, {s["channels"]} channel(s)) to mono 44.1 kHz 192 kb/s MP3; resampled/downmixed only where needed and stripped metadata. No trimming, denoising, pitch shift, time stretch or loudness normalization. Speech sequence is unchanged; lossy encoding and any downmix may affect sound, and encoder padding may affect file duration.'
  c={'id':filename[:-4],'languageId':'de','text':word,'targetIPA':'/'+ipa+'/','voiceId':speaker['id'],'url':'/audio/human-de-i-length/clips/'+filename,'status':'source-verified-unreviewed','provider':'wikimedia-commons','synthetic':False,'speaker':speaker['name'],'author':speaker['name'],'speakerAttribution':clean(ext['Artist']['value']),'locale':speaker['locale'],'targetLocale':'de-DE','dialectSourceStatus':speaker['dialectSourceStatus'],'sourceTitle':page['title'],'sourceTranscription':word,'sourceTranscriptionEvidence':evidence,'sourcePage':source_page,'sourceRevision':'https://commons.wikimedia.org/w/index.php?'+urllib.parse.urlencode({'title':page['title'],'oldid':revision['revid']}),'sourceRevisionId':revision['revid'],'sourceRevisionTimestamp':revision['timestamp'],'pronunciationSourceEvidence':{'source':'German Wiktionary, German-language section','page':'https://de.wiktionary.org/wiki/'+word,'revisionId':entry['revisions'][0]['revid'],'ipa':ipa,'limitation':'Dictionary target and exact audio-link identity, not an independent listening verdict'},'originalUrl':info['url'],'originalUploadTimestamp':info['timestamp'],'originalRecordingDate':clean(ext.get('DateTimeOriginal',{}).get('value','')),'sourceProject':'Wikimedia Commons / German Wiktionary','sourceCredit':clean(ext.get('Credit',{}).get('value','')),'originalCopyrightNotice':tags.get('COPYRIGHT',''),'originalLicenseNotice':tags.get('LICENSE',''),'additionalAttribution':tags['ARTIST']if tags.get('ARTIST')and speaker['name'].lower()not in tags['ARTIST'].lower()else'','sourceSpeakerMetadata':{k:tags[k]for k in['SWAC_TEXT','SWAC_SPEAK_NAME','SWAC_SPEAK_LANG','SWAC_SPEAK_LANG_COUNTRY','SWAC_SPEAK_LANG_REGION','ARTIST','TITLE']if k in tags},'license':{'id':speaker['licenseId'],'url':speaker['licenseUrl'],'attributionRequired':True,'commercialReusePermitted':True,'shareAlike':True},'licenseEvidenceStatus':'exact-file compiled metadata plus explicit license/migration template checked','sourceSha1':info['sha1'],'originalSha256':digest(original),'sha256':digest(output),'bytes':output.stat().st_size,'durationSeconds':float(ep['format']['duration']),'sourceDurationSeconds':float(p['format']['duration']),'sampleRate':44100,'channels':1,'originalSampleRate':int(s['sample_rate']),'originalChannels':s['channels'],'changes':changes,'phoneticListeningVerified':False,'speakerConsistencyVerified':False,'speakerIdentityStatus':'source-credited contributor; same audible speaker not independently verified','originalPrivatePath':str(original.relative_to(BASE)),'recordingConditionWarning':'Source/upload versions correlate with target category within each contributor; audible cue risk requires review. Not a controlled same-session collection.'}
  clips.append(c);write(BASE/'acquisition-progress.json',{'clips':clips,'publicAudioChanged':False});print(json.dumps({'acquired':len(clips),'of':8,'speaker':speaker['name'],'word':word}),flush=True)
 voices=[{k:v for k,v in speaker.items()if k not in['suffix','licenseName']}for speaker in SPEAKERS]
 manifest={'schemaVersion':1,'collectionId':'human-de-i-length-pronouns-v1','createdAt':datetime.now(timezone.utc).isoformat(),'status':'private-candidate-not-deployed','publicDeploymentApproved':False,'defaultReplacementApproved':False,'phoneticListeningVerified':False,'speakerConsistencyVerified':False,'voicesByLanguage':{'de':voices},'clips':clips,'eligibleContrasts':[{'languageId':'de','contrastId':'de-i-length-pronouns','pairIds':['de-in-ihn','de-im-ihm'],'pairCount':2,'completeForListedPairs':True,'completeForEntireContrast':True,'mainCurriculumReplacement':False,'phoneticListeningVerified':False}],'scopeNote':'Exactly two lexical pairs, in/ihn and im/ihm, with two source-credited contributors. No third pair or existing full German lesson is supplied. Small-pool token memorization and category-correlated source-version histories remain limitations. Actual pronunciation, accent and speaker consistency are unreviewed.'}
 write(BASE/'manifest.candidate.json',manifest)
 safe=json.loads(json.dumps(manifest))
 for clip in safe['clips']:clip.pop('originalPrivatePath',None)
 write(BASE/'manifest.preview.json',safe)
 write(BASE/'attribution.json',{'scope':'Only these eight German two-pair candidate clips; each file retains its own license version','records':[{'text':c['text'],'voiceId':c['voiceId'],'author':c['author'],'title':c['sourceTitle'],'sourcePage':c['sourcePage'],'sourceRevision':c['sourceRevision'],'license':c['license']['id'],'licenseUrl':c['license']['url'],'changes':c['changes'],'sourceProject':c['sourceProject'],'copyrightNotice':c['originalCopyrightNotice'],'additionalAttribution':c['additionalAttribution'],'originalLicenseNotice':c['originalLicenseNotice']}for c in clips]})
 print(json.dumps({'clips':len(clips),'bytes':sum(c['bytes']for c in clips),'phoneticListeningVerified':False,'publicAudioChanged':False}))
if __name__=='__main__':main()
