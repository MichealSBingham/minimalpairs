#!/usr/bin/env python3
"""Acquire the English human pilot privately; never changes the public app."""
import hashlib, html, json, math, os, pathlib, re, subprocess, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from discover import BASE, HEADERS, WORDS

SPEAKERS = [
    {'id':'human-en-grendelkhan', 'name':'Grendelkhan', 'prefix':'File:LL-Q1860 (eng)-Grendelkhan-', 'extension':'.wav',
     'licenseId':'CC0-1.0', 'licenseMetadata':'CC0', 'licenseUrl':'https://creativecommons.org/publicdomain/zero/1.0/',
     'licenseTemplate':'{{cc-zero}}', 'sourceProject':'Lingua Libre', 'locale':'en', 'speakerEntity':'https://lingualibre.org/wiki/Q929501',
     'speakerSource':'https://commons.wikimedia.org/wiki/User:Grendelkhan',
     'description':'Human recording · native English self-declaration; regional accent unreviewed',
     'localeEvidence':'Commons public profile declares native English. Source records identify English (Q1860). Regional accent and General American suitability are not established.'},
    {'id':'human-en-dvortygirl', 'name':'Dvortygirl', 'prefix':'File:En-us-', 'extension':'.ogg',
     'licenseId':'CC-BY-SA-3.0', 'licenseMetadata':'CC BY-SA 3.0', 'licenseUrl':'https://creativecommons.org/licenses/by-sa/3.0/',
     'licenseTemplate':'Cc-by-sa-3.0-migrated', 'sourceProject':'Wikimedia Commons / Wiktionary', 'locale':'en-US',
     'speakerSource':'https://commons.wikimedia.org/wiki/User:Dvortygirl',
     'description':'Human recording · source identifies US English; listening review pending',
     'localeEvidence':'Exact file pages identify US English, own recordings and Dvortygirl as author; original upload comments explicitly identify Dvortygirl as recorder for five files and the fill description identifies the author. Public profile declares native English. Accent suitability remains unreviewed.'},
]

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def digest(path, algorithm='sha256'):
    return hashlib.new(algorithm, path.read_bytes()).hexdigest()

def clean_html(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', value))).strip()

def probe(path):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_name,sample_rate,channels:stream_tags:format=duration:format_tags','-of','json',str(path)], text=True))

def download(url):
    cooldown = BASE / 'private/retry-not-before.json'
    # Honor prior Wikimedia media restrictions across this and the French work.
    for recorded in [cooldown, BASE.parent / 'human-pilot/private/retry-not-before.json']:
        if recorded.exists():
            remaining = math.ceil(json.loads(recorded.read_text())['epoch'] - time.time())
            if remaining > 0:
                raise RuntimeError(f'Wikimedia cooldown active for {remaining} seconds; no request sent.')
    parts = urllib.parse.urlsplit(url)
    assert parts.scheme == 'https' and parts.hostname == 'upload.wikimedia.org'
    canonical = urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, '', ''))
    try:
        with urllib.request.urlopen(urllib.request.Request(canonical, headers=HEADERS), timeout=40) as response:
            data = response.read(2_000_001)
    except urllib.error.HTTPError as error:
        if error.code == 429:
            raw = error.headers.get('Retry-After', '600')
            try:
                delay = max(1, int(raw))
            except ValueError:
                delay = max(1, math.ceil(parsedate_to_datetime(raw).timestamp() - time.time()))
            # No automatic retry and no alternate host: stop with a recorded deadline.
            deadline = time.time() + max(30, delay)
            write(cooldown, {'epoch':deadline, 'reason':'Wikimedia HTTP 429 Retry-After', 'retryAfter':raw, 'notBefore':datetime.fromtimestamp(deadline, timezone.utc).isoformat()})
            raise RuntimeError(f'Wikimedia cooldown recorded; retry no earlier than {datetime.fromtimestamp(deadline, timezone.utc).isoformat()}') from None
        raise
    assert len(data) <= 2_000_000
    time.sleep(5)
    return data

def source_records():
    metadata = json.loads((BASE / 'sources/metadata-candidates.json').read_text())
    pages = {p['title']:p for p in metadata['query']['pages'].values()}
    entities = json.loads((BASE / 'sources/candidate-mediainfo.json').read_text())['entities']
    history = {p['title']:p for p in json.loads((BASE / 'sources/legacy-upload-provenance.json').read_text())['query']['pages'].values()}
    selected = []
    for speaker in SPEAKERS:
        for word in WORDS:
            title = speaker['prefix'] + word + speaker['extension']
            page = pages[title]; info = page['imageinfo'][0]; ext = info['extmetadata']
            wikitext = page['revisions'][0]['slots']['main']['*']
            assert ext['LicenseShortName']['value'] == speaker['licenseMetadata']
            assert speaker['licenseTemplate'] in wikitext
            author = clean_html(ext['Artist']['value'])
            assert speaker['name'] in author
            if speaker['id'] == 'human-en-grendelkhan':
                entity = entities['M' + str(page['pageid'])]
                transcription = entity['statements']['P9533'][0]['mainsnak']['datavalue']['value']
                assert transcription == {'text':word, 'language':'en'}
                assert 'Q929501' in ext['Artist']['value']
                evidence = {'kind':'Commons MediaInfo exact transcription (P9533)', 'mediaInfoId':entity['id'], 'mediaInfoRevisionId':entity['lastrevid'], 'text':word, 'language':'en'}
            else:
                current = history[title]['imageinfo'][0]
                assert current['sha1'] == info['sha1']
                comment = current['comment']
                if word == 'fill':
                    assert "Audio pronunciation of the term 'fill' in United States English." in wikitext
                    assert '|Source= Self, recorded using the program' in wikitext
                    evidence = {'kind':'Explicit source file-description transcription and own-recording credit', 'text':word, 'description':clean_html(ext['ImageDescription']['value'])}
                else:
                    assert '[[Category:English pronunciation|' + word + ']]' in comment
                    assert 'Pronunciation of the term in US English, recorded by [[User:Dvortygirl|Dvortygirl]]' in comment
                    evidence = {'kind':'Original upload description identifies the term and recorder; not filename-only', 'text':word, 'uploadComment':comment, 'uploadTimestamp':current['timestamp']}
                assert 'English' in clean_html(ext['ImageDescription']['value'])
            selected.append((speaker, word, page, evidence))
    return selected

def main():
    records = source_records()  # License, creator and exact word checks precede all downloads.
    private = BASE / 'private'; originals = private / 'originals'
    originals.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(private, 0o700); os.chmod(originals, 0o700)
    (BASE / 'clips').mkdir(exist_ok=True)
    clips = []
    for speaker, word, page, evidence in records:
        info = page['imageinfo'][0]; ext = info['extmetadata']
        original = originals / (speaker['id'] + '-' + word + speaker['extension'])
        assert info['size'] < 2_000_000
        if not original.exists():
            original.write_bytes(download(info['url'])); os.chmod(original, 0o600)
        assert original.stat().st_size == info['size']
        assert digest(original, 'sha1') == info['sha1']
        original_info = probe(original)
        tags = {k.upper():v.strip() for k,v in original_info['streams'][0].get('tags',{}).items()}
        tags.update({k.upper():v.strip() for k,v in original_info.get('format',{}).get('tags',{}).items()})
        # Declared spoken-text tags override a plausible filename or category.
        if tags.get('SWAC_TEXT'):
            assert tags['SWAC_TEXT'] == word, f'Embedded spoken text differs for {page["title"]}: {tags["SWAC_TEXT"]}'
        original_sha = digest(original)
        filename = hashlib.sha256((original_sha + '|mp3-libmp3lame-192k-44100hz-mono-v2').encode()).hexdigest()[:24] + '.mp3'
        output = BASE / 'clips' / filename
        if not output.exists():
            subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(original),'-map','0:a:0','-map_metadata','-1','-ar','44100','-ac','1','-c:a','libmp3lame','-b:a','192k',str(output)], check=True)
        encoded_info = probe(output)
        subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(output),'-f','null','-'], check=True, stdout=subprocess.DEVNULL)
        original_stream = original_info['streams'][0]; encoded_stream = encoded_info['streams'][0]
        assert encoded_stream['sample_rate'] == '44100'
        assert encoded_stream['channels'] == 1
        assert abs(float(original_info['format']['duration']) - float(encoded_info['format']['duration'])) < .1
        source_page = 'https://commons.wikimedia.org/wiki/' + urllib.parse.quote(page['title'].replace(' ','_'), safe=':()')
        revision = page['revisions'][0]
        source_rate = int(original_stream['sample_rate']); source_channels = original_stream['channels']
        changes = f'Encoded from original {"WAV" if speaker["extension"] == ".wav" else "Ogg Vorbis"} ({source_rate} Hz, {source_channels} channel(s)) to 192 kbps, 44100 Hz mono MP3 using libmp3lame. Sample-rate conversion and stereo downmix applied where needed; file metadata stripped. No trimming, denoising, time stretching, pitch shifting or loudness normalization. Downmix can change channel balance. MP3 duration may include encoder padding.'
        clip = {'id':filename.removesuffix('.mp3'), 'languageId':'en', 'text':word, 'voiceId':speaker['id'], 'url':'/audio/human-en-i-ih/clips/' + filename,
            'status':'source-verified-unreviewed', 'provider':'wikimedia-commons', 'synthetic':False, 'speaker':speaker['name'], 'author':speaker['name'],
            'speakerAttribution':clean_html(ext['Artist']['value']), 'locale':speaker['locale'], 'sourceTitle':page['title'], 'sourceTranscription':word,
            'sourceTranscriptionEvidence':evidence, 'sourcePage':source_page,
            'sourceRevision':'https://commons.wikimedia.org/w/index.php?' + urllib.parse.urlencode({'title':page['title'],'oldid':revision['revid']}),
            'sourceRevisionId':revision['revid'], 'sourceRevisionTimestamp':revision['timestamp'], 'originalUrl':info['url'], 'originalUploadTimestamp':info['timestamp'],
            'originalRecordingDate':clean_html(ext.get('DateTimeOriginal',{}).get('value','')), 'originalCopyrightNotice':tags.get('COPYRIGHT',''), 'originalLicenseNotice':tags.get('LICENSE',''),
            'additionalAttribution':tags['ARTIST'] if tags.get('ARTIST') and tags['ARTIST'] != speaker['name'] else '',
            'sourceSpeakerMetadata':{k:tags[k] for k in ['SWAC_TEXT','SWAC_SPEAK_NAME','SWAC_SPEAK_LANG','SWAC_SPEAK_LANG_COUNTRY','SWAC_SPEAK_LANG_REGION','ARTIST','TITLE'] if k in tags},
            'sourceProject':speaker['sourceProject'], 'sourceCredit':clean_html(ext.get('Credit',{}).get('value','')),
            'license':{'id':speaker['licenseId'], 'url':speaker['licenseUrl'], 'attributionRequired':speaker['licenseId'] != 'CC0-1.0', 'commercialReusePermitted':True, 'shareAlike':speaker['licenseId'] == 'CC-BY-SA-3.0'},
            'licenseEvidenceStatus':'exact-file-page-and-license-template-checked', 'sourceSha1':info['sha1'], 'originalSha256':original_sha,
            'sha256':digest(output), 'bytes':output.stat().st_size, 'durationSeconds':float(encoded_info['format']['duration']), 'sampleRate':int(encoded_stream['sample_rate']), 'channels':encoded_stream['channels'], 'originalSampleRate':source_rate, 'originalChannels':source_channels,
            'changes':changes, 'phoneticListeningVerified':False, 'speakerIdentityStatus':'credited-by-source; not independently identity-verified', 'originalPrivatePath':str(original.relative_to(BASE))}
        clips.append(clip)
        print(json.dumps({'acquired':len(clips), 'of':12, 'speaker':speaker['name'], 'word':word}), flush=True)
    voices = [{**{k:v for k,v in speaker.items() if k not in ('prefix','extension','licenseMetadata','licenseTemplate')}, 'source':'human-recording'} for speaker in SPEAKERS]
    manifest = {'schemaVersion':1, 'createdAt':datetime.now(timezone.utc).isoformat(), 'status':'private-candidate-not-deployed', 'publicDeploymentApproved':False,
        'phoneticListeningVerified':False, 'voicesByLanguage':{'en':voices}, 'clips':clips,
        'eligibleContrasts':[{'languageId':'en','contrastId':'en-i-ih','pairIds':['en-ship-sheep','en-fill-feel','en-sit-seat'],'completeForListedPairs':True,'completeForEntireContrast':True}],
        'scopeNote':'Optional English three-pair human-audio candidate. General American suitability, actual pronunciation and recording quality are not listening-verified. No public application audio changed.'}
    write(BASE / 'manifest.candidate.json', manifest)
    write(BASE / 'sources/selected-file-metadata.json', {'retrievedDate':'2026-09-28','sourceApi':'https://commons.wikimedia.org/w/api.php','pages':[page for _,_,page,_ in records]})
    write(BASE / 'verification.json', {'files':12,'speakers':2,'matchedPairs':3,'audioBytes':sum(c['bytes'] for c in clips),'sourceSha1Checked':True,'decodedAllFiles':True,
        'sourceTranscriptionMetadataChecked':True,'outputSampleRate':44100,'outputChannels':1,'sampleRatesAndChannelsPreserved':False,'durationPreservedWithinSeconds':.1,'licensesCheckedPerFile':True,'phoneticListeningVerified':False,'publicAudioChanged':False})
    print(json.dumps({'complete':True,'files':12,'audioBytes':sum(c['bytes'] for c in clips),'phoneticListeningVerified':False}))

if __name__ == '__main__':
    main()
