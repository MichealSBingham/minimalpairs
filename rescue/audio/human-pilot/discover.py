#!/usr/bin/env python3
"""Read-only Wikimedia search for matched human French recordings."""
import collections,json,pathlib,re,time,urllib.parse,urllib.request
BASE=pathlib.Path(__file__).resolve().parent
HEADERS={'User-Agent':'MinimalPairsRescue/1.0 (public media provenance research; minimalpairs.co)'}
def api(params):
 url='https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode({'format':'json',**params})
 with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=40) as r:return json.load(r)
words=['tout','tu','vous','vu','roue','rue','bout','bu']
coverage=collections.defaultdict(dict)
for word in words:
 path=BASE/'sources'/f'search-{word}.json'
 if path.exists():d=json.loads(path.read_text())
 else:
  d=api({'action':'query','list':'search','srsearch':f'intitle:"LL-Q150" intitle:"{word}.wav"','srnamespace':6,'srlimit':500})
  path.write_text(json.dumps(d,ensure_ascii=False,indent=2))
  time.sleep(.15)
 for result in d['query']['search']:
  m=re.fullmatch(r'File:LL-Q150 \(fra\)-(.+)-'+re.escape(word)+r'\.wav',result['title'])
  if m:coverage[m.group(1)][word]=result['title']
 print(word,'hits',d['query']['searchinfo']['totalhits'],'retrieved',len(d['query']['search']))
ranked=sorted(coverage.items(),key=lambda item:(-len(item[1]),item[0]))
(BASE/'sources'/'speaker-coverage-search.json').write_text(json.dumps(dict(ranked),ensure_ascii=False,indent=2))
for speaker,records in ranked:
 if len(records)>=4:print(speaker,len(records),','.join(records))
