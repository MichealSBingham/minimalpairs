"""Read a bounded list of editorial candidates from ATILF's public lookup.
Stores source facts and a brief pronunciation excerpt only, not dictionary prose/audio.
The URL shape comes from the site's public getEntry implementation.
"""
import json,re,html,time
from urllib.request import urlopen
from urllib.parse import quote
from urllib.error import HTTPError
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORDS=['pré','prêt','thé','taie','dé','dais','bain','bon','pin','pont','teint','ton','banc','pan','pain','temps','côte','cote','paume','pomme','saute','sotte','beau','peau','boule','poule','joue','chou','gens','champ','geai','chai']
path=ROOT/'french-expansion-source-audit.json'
existing=json.loads(path.read_text())['words'] if path.exists() else []
cache={r['word']:r for r in existing}
rows=[]
for word in WORDS:
 if word in cache: rows.append(cache[word]);continue
 lookup_word='sot' if word=='sotte' else word
 pos={'cote':'nom','teint':'nom','ton':'nom','pan':'nom','prêt':'adjectif','sotte':'adjectif','chou':'nom','bain':'nom','banc':'nom','boule':'nom'}.get(word,'')
 url='https://www.portail-lexical.fr/api/word/'+quote(lookup_word)+'/'+pos
 try:
  j=json.load(urlopen(url,timeout=25)); head=j.get('header',{})
  tlfi=next((x['content'] for x in j.get('content',[]) if x['id']=='tlfi'),[])
  clean=html.unescape(re.sub('<[^>]+>',' ',' '.join(tlfi)));clean=re.sub(r'\s+',' ',clean)
  m=re.search(r'Prononciation(?: et orthographe)?',clean)
  excerpt=' '.join(clean[m.end():].split()[:22]) if m else None
  row=dict(word=word,source='ATILF public lookup; TLFi section',lookupUrl=url,referenceUrl='https://www.portail-lexical.fr/definition/tlfi/'+quote(lookup_word)+('/'+pos if pos else ''),headerForm=head.get('full_form'),headerIpa=head.get('ipa'),tlfiAvailable=bool(tlfi),pronunciationExcerpt=excerpt,status='read')
 except HTTPError as e:
  if e.code==429: raise SystemExit('Stopped on rate limit; do not retry automatically.')
  row=dict(word=word,status='not-read',error=str(e))
 rows.append(row)
 path.write_text(json.dumps(dict(date='2026-09-28',limitation='Header IPA may combine portal resources. The separate short TLFi excerpt identifies the historical dictionary pronunciation actually retrieved; editorial broad IPA is not copied source audio or certified speaker realization.',words=rows),ensure_ascii=False,indent=2)+'\n')
 print(word,row.get('headerIpa'),row.get('headerForm'),row.get('pronunciationExcerpt'),flush=True)
 time.sleep(.25)
