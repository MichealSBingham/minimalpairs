#!/usr/bin/env python3
"""Bounded exact-word Commons discovery; cached primary API evidence only."""
import collections,json,math,pathlib,re,time,urllib.error,urllib.parse,urllib.request
from datetime import datetime,timezone
from email.utils import parsedate_to_datetime
BASE=pathlib.Path(__file__).resolve().parent
HEADERS={'User-Agent':'MinimalPairsRescue/1.0 (public media provenance research; minimalpairs.co)'}
REQUEST=json.loads((BASE.parent.parent/'content/english-legacy-batch1-audio-request.json').read_text())
WORDS=[w['text']for w in REQUEST['newWords']]
def write(path,value):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def cooldown_check():
 for p in BASE.parent.glob('*/private/retry-not-before.json'):
  deadline=json.loads(p.read_text())['epoch']
  if deadline>time.time():raise RuntimeError(f'Wikimedia cooldown remains until {datetime.fromtimestamp(deadline,timezone.utc).isoformat()}; no request sent')
def request(url,maxbytes=8000000):
 cooldown_check()
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=45)as r:
   data=r.read(maxbytes+1)
 except urllib.error.HTTPError as e:
  if e.code==429:
   raw=e.headers.get('Retry-After','600')
   try:delay=max(30,int(raw))
   except ValueError:delay=max(30,math.ceil(parsedate_to_datetime(raw).timestamp()-time.time()))
   deadline=time.time()+delay
   write(BASE/'private/retry-not-before.json',{'epoch':deadline,'notBefore':datetime.fromtimestamp(deadline,timezone.utc).isoformat(),'retryAfter':raw,'reason':'Wikimedia HTTP429; no alternate host retry'})
   raise RuntimeError(f'Wikimedia Retry-After until {datetime.fromtimestamp(deadline,timezone.utc).isoformat()}')from None
  raise
 if len(data)>maxbytes:raise RuntimeError('Response exceeds bounded size')
 return data
def cached(name,params,host='commons.wikimedia.org'):
 path=BASE/'sources'/name
 if path.exists():return json.loads(path.read_text())
 url=f'https://{host}/w/api.php?'+urllib.parse.urlencode({'format':'json',**params})
 result=json.loads(request(url));
 if 'error'in result:raise RuntimeError(result['error'])
 write(path,result);time.sleep(5)
 return result
def main():
 coverage=collections.defaultdict(dict);totals={}
 for word in WORDS:
  data=cached(f'search-{word}.json',{'action':'query','list':'search','srsearch':f'intitle:"LL-Q1860" intitle:"{word}.wav"','srnamespace':6,'srlimit':100})
  hits=data['query']['search'];totals[word]={'totalHits':data['query']['searchinfo']['totalhits'],'retrieved':len(hits),'limit':100}
  for hit in hits:
   match=re.fullmatch(r'File:LL-Q1860 \(eng\)-(.+)-'+re.escape(word)+r'\.wav',hit['title'],re.I)
   if match:coverage[match.group(1)][word]=hit['title']
  print(json.dumps({'word':word,'hits':totals[word],'speakers':[s for s,ws in coverage.items()if word in ws]}),flush=True)
 summary={'retrievedAt':datetime.now(timezone.utc).isoformat(),'exactWords':WORDS,'boundedSearchTotals':totals,'speakers':dict(sorted(coverage.items(),key=lambda x:(-len(x[1]),x[0])))}
 write(BASE/'sources/coverage.json',summary)
 legacy_titles=['File:En-us-'+w+'.ogg'for w in WORDS]
 cached('legacy-metadata.json',{'action':'query','titles':'|'.join(legacy_titles),'prop':'imageinfo|revisions','iiprop':'url|size|sha1|extmetadata|timestamp|user|comment','rvprop':'ids|timestamp|content','rvslots':'main'})
 print(json.dumps({'speakerCoverage':{s:len(ws)for s,ws in summary['speakers'].items()}},indent=2))
if __name__=='__main__':main()
