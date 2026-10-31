#!/usr/bin/env python3
"""Focused exact Spanish starter words; cached primary Wikimedia evidence."""
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
