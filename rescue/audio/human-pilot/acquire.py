#!/usr/bin/env python3
"""Acquire a separately licensed human pilot; never touches public application audio."""
import hashlib,html,json,os,pathlib,re,subprocess,time,urllib.error,urllib.parse,urllib.request
from datetime import datetime,timezone
BASE=pathlib.Path(__file__).resolve().parent
HEADERS={'User-Agent':'MinimalPairsRescue/1.0 (public media provenance research; minimalpairs.co)'}
WORDS=['tout','tu','vous','vu','roue','rue']
SPEAKERS=[
 {'id':'human-fr-sartus85','name':'Sartus85','sourceAuthor':'Sartus85','filePrefix':'File:LL-Q150 (fra)-Sartus85-','extension':'.wav','licenseId':'CC-BY-SA-4.0','licenseMetadata':'CC BY-SA 4.0','licenseUrl':'https://creativecommons.org/licenses/by-sa/4.0/','attributionRequired':True,'locale':'fr','localeEvidence':'Exact file pages identify French (Q150) and speaker Sartus85 (Lingua Libre Q1422544). Regional accent and native-language status were not independently established.','description':'Human recording · French; regional accent unreviewed','sourceProject':'Lingua Libre','speakerSource':'https://lingualibre.org/wiki/Q1422544'},
 {'id':'human-fr-poslovitch','name':'Poslovitch','sourceAuthor':'Poslovitch','filePrefix':'File:LL-Q150 (fra)-Poslovitch-','extension':'.wav','licenseId':'CC0-1.0','licenseMetadata':'CC0','licenseUrl':'https://creativecommons.org/publicdomain/zero/1.0/','attributionRequired':False,'locale':'fr','localeEvidence':'Public user profile declares native French (fr-N). Regional accent is unverified; archived Lingua Libre speaker entity was not retrievable.','description':'Human recording · native French self-declaration; regional accent unreviewed','sourceProject':'Lingua Libre','speakerSource':'https://commons.wikimedia.org/wiki/User:Poslovitch','speakerEntity':'https://lingualibre.org/wiki/Q142683'},
]
def digest(path,algorithm='sha256'):
 return hashlib.new(algorithm,path.read_bytes()).hexdigest()
def probe(path):
 out=subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_name,sample_rate,channels,bits_per_sample:stream_tags:format=duration','-of','json',str(path)],text=True)
 return json.loads(out)
def write(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def clean_html(value):return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',value))).strip()
def download(url):
 cooldown=BASE/'private/retry-not-before.json'
 if cooldown.exists():
  remaining=int(json.loads(cooldown.read_text())['epoch']-time.time())
  if remaining>0:raise RuntimeError(f'Wikimedia cooldown remains active for {remaining} seconds; no request sent.')
 # Canonical asset URL; discard only API-added analytics parameters.
 parts=urllib.parse.urlsplit(url)
 request_url=urllib.parse.urlunsplit((parts.scheme,parts.netloc,parts.path,'',''))
 for attempt in range(4):
  try:
   with urllib.request.urlopen(urllib.request.Request(request_url,headers=HEADERS),timeout=40) as response:
    content=response.read(2_000_001)
   time.sleep(5)
   return content
  except urllib.error.HTTPError as error:
   if error.code!=429 or attempt==3:raise
   delay=int(error.headers.get('Retry-After','30'))
   if delay>60:
    write(cooldown,{'epoch':time.time()+delay,'reason':'Wikimedia HTTP 429 Retry-After','seconds':delay})
    raise RuntimeError(f'Wikimedia asks for a {delay}-second retry delay; stop this batch and retry later.') from None
   delay=max(30,delay)
   print(f'Wikimedia rate limit: honoring a {delay}-second delay.',flush=True)
   time.sleep(max(1,delay))
def main():
 metadata=json.loads((BASE/'sources/metadata-candidates.json').read_text())
 pages={p['title']:p for p in metadata['query']['pages'].values()}
 mediainfo=json.loads((BASE/'sources/selected-mediainfo.json').read_text())
 selected=[];clips=[]
 originals=BASE/'private/originals';originals.mkdir(parents=True,exist_ok=True,mode=0o700)
 os.chmod(BASE/'private',0o700);os.chmod(originals,0o700)
 (BASE/'clips').mkdir(exist_ok=True)
 for speaker in SPEAKERS:
  for word in WORDS:
   title=speaker['filePrefix']+word+speaker['extension'];page=pages[title]
   info=page['imageinfo'][0];ext=info['extmetadata']
   assert ext['LicenseShortName']['value']==speaker['licenseMetadata'],f'Unexpected license for {title}'
   artist=clean_html(ext['Artist']['value'])
   assert speaker['sourceAuthor'] in artist,f'Unexpected attribution for {title}'
   license_template='{{cc-zero}}' if speaker['licenseId']=='CC0-1.0' else '{{cc-by-sa-4.0}}'
   wikitext=page['revisions'][0]['slots']['main']['*']
   assert license_template in wikitext,f'Missing license template for {title}'
   if speaker['id']=='human-fr-sartus85':
    assert re.search(r'\|\s*transcription\s*=\s*'+re.escape(word)+r'\s*\n',wikitext),f'Transcription mismatch: {title}'
    assert re.search(r'\|\s*speakerId\s*=\s*Q1422544\s*\n',wikitext)
    source_transcription=word
   else:
    entity=mediainfo['entities']['M'+str(page['pageid'])]
    source_transcription=entity['statements']['P9533'][0]['mainsnak']['datavalue']['value']['text']
    assert source_transcription==word,f'Transcription mismatch: {title}'
   original=originals/(speaker['id']+'-'+word+speaker['extension'])
   url=info['url']
   assert urllib.parse.urlparse(url).hostname=='upload.wikimedia.org'
   assert info['size']<2_000_000
   if not original.exists():
    content=download(url)
    assert len(content)<=2_000_000
    original.write_bytes(content);os.chmod(original,0o600)
   assert original.stat().st_size==info['size'],f'Source size mismatch: {title}'
   assert digest(original,'sha1')==info['sha1'],f'Source SHA1 mismatch: {title}'
   original_sha=digest(original); filename=hashlib.sha256((original_sha+'|mp3-libmp3lame-192k-source-rate-channels-v1').encode()).hexdigest()[:24]+'.mp3'
   output=BASE/'clips'/filename
   if not output.exists():
    subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(original),'-map','0:a:0','-map_metadata','-1','-c:a','libmp3lame','-b:a','192k',str(output)],check=True)
   original_info=probe(original);encoded_info=probe(output)
   subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(output),'-f','null','-'],check=True,stdout=subprocess.DEVNULL)
   original_stream=original_info['streams'][0];output_stream=encoded_info['streams'][0]
   tags={k:v.strip() for k,v in original_stream.get('tags',{}).items()}
   assert original_stream['sample_rate']==output_stream['sample_rate']
   assert original_stream['channels']==output_stream['channels']
   assert abs(float(original_info['format']['duration'])-float(encoded_info['format']['duration']))<.1
   page_url='https://commons.wikimedia.org/wiki/'+urllib.parse.quote(title.replace(' ','_'),safe=':()')
   revision_url='https://commons.wikimedia.org/w/index.php?'+urllib.parse.urlencode({'title':title,'oldid':page['revisions'][0]['revid']})
   clip={'id':filename.removesuffix('.mp3'),'languageId':'fr','text':word,'voiceId':speaker['id'],
         'url':'/audio/human-fr-u-y/clips/'+filename,'status':'source-verified-unreviewed','provider':'wikimedia-commons','synthetic':False,
         'speaker':speaker['name'],'author':speaker['sourceAuthor'],'speakerAttribution':artist,'locale':speaker['locale'],
         'sourceTitle':title,'sourceTranscription':source_transcription,'sourcePage':page_url,'sourceRevision':revision_url,'sourceRevisionId':page['revisions'][0]['revid'],
         'sourceRevisionTimestamp':page['revisions'][0]['timestamp'],'originalUrl':url,'originalUploadTimestamp':info['timestamp'],
         'originalRecordingDate':clean_html(ext.get('DateTimeOriginal',{}).get('value','')),
         'originalCopyrightNotice':tags.get('COPYRIGHT',''),
         'sourceSpeakerMetadata':{k:tags[k] for k in ['SWAC_SPEAK_NAME','SWAC_SPEAK_LANG','SWAC_SPEAK_LANG_COUNTRY','SWAC_SPEAK_LANG_REGION','SWAC_TEXT'] if k in tags},
         'sourceProject':speaker['sourceProject'],'sourceCredit':clean_html(ext.get('Credit',{}).get('value','')),
         'license':{'id':speaker['licenseId'],'url':speaker['licenseUrl'],'attributionRequired':speaker['attributionRequired'],'commercialReusePermitted':True,'shareAlike':speaker['licenseId']=='CC-BY-SA-4.0'},
         'licenseEvidenceStatus':'exact-file-page-and-template-checked','sourceSha1':info['sha1'],'originalSha256':original_sha,'sha256':digest(output),'bytes':output.stat().st_size,
         'durationSeconds':float(encoded_info['format']['duration']),'sampleRate':int(output_stream['sample_rate']),'channels':output_stream['channels'],
         'changes':'Encoded from original WAV to 192 kbps MP3 using libmp3lame; original sample rate and channel count preserved. File metadata stripped. No trimming, denoising, speed, pitch or loudness changes. MP3 container duration may include encoder padding.',
         'phoneticListeningVerified':False,'speakerIdentityStatus':'credited-by-source; not independently identity-verified',
         'originalPrivatePath':str(original.relative_to(BASE))}
   clips.append(clip);selected.append(page)
 write(BASE/'sources/selected-file-metadata.json',{'retrievedDate':'2026-09-28','sourceApi':'https://commons.wikimedia.org/w/api.php','pages':selected})
 voices=[{**{k:v for k,v in s.items() if k not in ('filePrefix','extension','licenseMetadata')},'source':'human-recording'} for s in SPEAKERS]
 manifest={'schemaVersion':1,'createdAt':datetime.now(timezone.utc).isoformat(),'status':'private-candidate-not-deployed','publicDeploymentApproved':False,
           'phoneticListeningVerified':False,'voicesByLanguage':{'fr':voices},'clips':clips,
           'eligibleContrasts':[{'languageId':'fr','contrastId':'fr-u-y','pairIds':['fr-tout-tu','fr-vous-vu','fr-roue-rue'],'completeForListedPairs':True,'completeForEntireContrast':False}],
           'scopeNote':'Use only the three listed pairs with this pilot. It is not a drop-in full-French manifest. No application audio was replaced.'}
 write(BASE/'manifest.candidate.json',manifest)
 write(BASE/'verification.json',{'files':len(clips),'speakers':len(voices),'matchedPairs':3,'audioBytes':sum(c['bytes'] for c in clips),'sourceSha1Checked':True,'decodedAllFiles':True,'sampleRatesAndChannelsPreserved':True,'durationPreservedWithinSeconds':.1,'licensesCheckedPerFile':True,'phoneticListeningVerified':False,'publicAudioChanged':False})
 print(json.dumps({'files':len(clips),'speakers':len(voices),'matchedPairs':3,'audioBytes':sum(c['bytes'] for c in clips),'phoneticListeningVerified':False}))
if __name__=='__main__':main()
