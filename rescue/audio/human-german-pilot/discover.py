#!/usr/bin/env python3
"""Focused exact German starter words; cached primary Wikimedia evidence."""
import hashlib, json, math, pathlib, re, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
BASE=pathlib.Path(__file__).resolve().parent
HEADERS={'User-Agent':'MinimalPairsRescue/1.0 (public media provenance research; minimalpairs.co)'}
def write(path,value):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def request(url,maxbytes=8000000):
 for path in BASE.parent.glob('*/private/retry-not-before.json'):
  deadline=json.loads(path.read_text())['epoch']
  if deadline>time.time():raise RuntimeError(f'Wikimedia cooldown until {datetime.fromtimestamp(deadline,timezone.utc).isoformat()}; no request sent')
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=45)as response:data=response.read(maxbytes+1)
 except urllib.error.HTTPError as error:
  if error.code==429:
   raw=error.headers.get('Retry-After','600')
   try:delay=max(30,int(raw))
   except ValueError:delay=max(30,math.ceil(parsedate_to_datetime(raw).timestamp()-time.time()))
   deadline=time.time()+delay;write(BASE/'private/retry-not-before.json',{'epoch':deadline,'notBefore':datetime.fromtimestamp(deadline,timezone.utc).isoformat(),'retryAfter':raw,'reason':'HTTP429; no early/alternate-host retry'})
   raise RuntimeError(f'Retry-After until {datetime.fromtimestamp(deadline,timezone.utc).isoformat()}')from None
  raise
 if len(data)>maxbytes:raise RuntimeError('Response exceeds bounded size')
 return data
def cached(name,params,host='commons.wikimedia.org'):
 path=BASE/'sources'/name
 if path.exists():return json.loads(path.read_text())
 url=f'https://{host}/w/api.php?'+urllib.parse.urlencode({'format':'json',**params})
 result=json.loads(request(url))
 if 'error'in result:raise RuntimeError(result['error'])
 write(path,result);time.sleep(5);return result
def main():
 curriculum=BASE.parent.parent/'content/curriculum.json';language=next(l for l in json.loads(curriculum.read_text())['languages']if l['id']=='de');contrasts=[c for c in language['contrasts']if c['id']in{'de-u-ue','de-i-length'}];words=[w['text']for c in contrasts for p in c['pairs']for w in p['words']]
 write(BASE/'scope-snapshot.json',{'languageId':'de','locale':language['locale'],'dialect':language['dialect'],'curriculumSha256':hashlib.sha256(curriculum.read_bytes()).hexdigest(),'contrasts':contrasts,'requestedWords':words})
 entries=cached('german-wiktionary-entries.json',{'action':'query','titles':'|'.join(words),'prop':'revisions','rvprop':'ids|timestamp|content','rvslots':'main'},'de.wiktionary.org')
 files=set();evidence=[]
 for page in entries['query']['pages'].values():
  if 'missing'in page:continue
  rev=page['revisions'][0];wiki=rev['slots']['main']['*'];audio_lines=[line for line in wiki.splitlines()if re.search(r'\{\{(?:Audio|audio|Hörbeispiele)',line)]
  evidence.append({'word':page['title'],'revisionId':rev['revid'],'lines':audio_lines})
  for line in audio_lines:
   files.update('File:'+name.strip()for name in re.findall(r'\{\{Audio\|([^|}]+)',line,re.I))
 write(BASE/'sources/dictionary-audio-map.json',evidence)
 print(json.dumps(evidence,ensure_ascii=False,indent=2),flush=True)
 titles=sorted(files)
 for i in range(0,len(titles),40):
  cached(f'dictionary-file-metadata-{i//40}.json',{'action':'query','titles':'|'.join(titles[i:i+40]),'prop':'imageinfo|revisions','iiprop':'url|size|sha1|extmetadata|timestamp|user|comment','rvprop':'ids|timestamp|content','rvslots':'main'})
 print(json.dumps({'dictionaryFiles':len(titles),'words':len(words)}),flush=True)
if __name__=='__main__':main()
