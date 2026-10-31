#!/usr/bin/env python3
"""Build attribution and per-file source audit from captured Commons evidence."""
import html,json,pathlib,urllib.parse
from acquire import BASE,WORDS,SPEAKERS,clean_html,write
pages={p['title']:p for p in json.loads((BASE/'sources/metadata-candidates.json').read_text())['query']['pages'].values()}
records=[]
for speaker in SPEAKERS:
 for word in WORDS:
  title=speaker['filePrefix']+word+speaker['extension'];page=pages[title];info=page['imageinfo'][0];ext=info['extmetadata']
  assert ext['LicenseShortName']['value']==speaker['licenseMetadata']
  records.append({'text':word,'languageId':'fr','voiceId':speaker['id'],'author':speaker['sourceAuthor'],'speaker':speaker['name'],
   'title':title,'sourcePage':'https://commons.wikimedia.org/wiki/'+urllib.parse.quote(title.replace(' ','_'),safe=':()'),
   'sourceRevision':'https://commons.wikimedia.org/w/index.php?'+urllib.parse.urlencode({'title':title,'oldid':page['revisions'][0]['revid']}),
   'license':speaker['licenseId'],'licenseUrl':speaker['licenseUrl'],'sourceProject':'Lingua Libre / Wikimedia Commons',
   'attributionRequired':speaker['attributionRequired'],'changes':'Original WAV transcoded to 192 kbps MP3. Sample rate/channels preserved; metadata stripped. No trimming, denoising, speed, pitch or loudness changes.',
   'sourceRecordingDate':clean_html(ext.get('DateTimeOriginal',{}).get('value','')),'sourceFileSha1':info['sha1'],'sourceFileBytes':info['size']})
write(BASE/'attribution.json',{'scope':'Only these 12 recordings; licenses remain per clip.','records':records})
lines=['# French human-recording pilot credits','',
 'These recordings come from Lingua Libre contributors through Wikimedia Commons. The speakers do not endorse MinimalPairs. They remain unreviewed for word identity, target phonemes, regional accent and recording quality.','',
 '**Sartus85 recordings:** [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Retain the credited speaker/recorder, source links, license and modification notice when distributing the MP3 copies. The converted files retain this license; any further adaptation must satisfy the applicable share-alike terms.','',
 '**Poslovitch recordings:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is retained voluntarily. These recordings remain CC0; the neighboring BY-SA recordings do not change their per-file license.','',
 '**Changes to all included clips:** original WAV transcoded to 192 kbps MP3 using libmp3lame, with source sample rate and channel count preserved. File metadata stripped. No trimming, denoising, speed, pitch or loudness changes.','',
 'The [CC BY-SA legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en) governs license conditions and disclaims warranties. No additional restrictions or implication of endorsement are attached to these licensed recordings.','',
 '| Word | Credited speaker and recorder | Source recording | License |','|---|---|---|---|']
for r in records:lines.append(f"| {r['text']} | {r['author']} | [{r['title']}]({r['sourcePage']}) | [{r['license']}]({r['licenseUrl']}) |")
(BASE/'ATTRIBUTION.md').write_text('\n'.join(lines)+'\n')
print('Wrote exact per-file attribution and source links for twelve recordings.')
