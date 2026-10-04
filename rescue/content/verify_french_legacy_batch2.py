"""Bounded editorial lookup of the second French restoration batch.

Read the public ATILF/TLFi API used by its lexical portal; retain source
identifiers and a brief pronunciation excerpt, never full entry prose/audio.
"""
import html
import json
import re
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
PATH = ROOT / 'french-legacy-batch2-source-audit.json'
CANDIDATES = json.loads((ROOT / 'french_legacy_batch2_candidates.json').read_text())
WORDS = list(dict.fromkeys(w[0] for c in CANDIDATES for p in c['pairs'] for w in p))
POS = {'jus':'nom','nous':'pronom','dent':'nom','vous':'pronom',
       'du':'article','cru':'adjectif','creux':'adjectif','feu':'nom','serre':'nom',
       'fin':'nom','faux':'adjectif','vain':'adjectif','chou':'nom','bain':'nom',
       'lit':'nom','lait':'nom','raie':'nom','rame':'nom','peigne':'nom',
       'reine':'nom','règne':'nom','bulle':'nom','bille':'nom','gomme':'nom'}
ENTRY_INDEX={'panne':2,'rame':1}
cache = {r['word']:r for r in json.loads(PATH.read_text())['words']} if PATH.exists() else {}
prior = json.loads((ROOT / 'french-expansion-source-audit.json').read_text())['words']
for row in prior:
    if row['word'] in WORDS and row.get('tlfiAvailable') and row.get('pronunciationExcerpt'):
        cache.setdefault(row['word'],dict(row,reusedFrom='french-expansion-source-audit.json'))
rows=[]
def save():
    PATH.write_text(json.dumps(dict(date='2026-09-28',
        limitation='Header IPA can combine portal resources. The separate short TLFi excerpt identifies retrieved dictionary pronunciation. Editorial broad IPA is not a certified speaker realization. Glosses are original summaries.',
        words=rows),ensure_ascii=False,indent=2)+'\n')
for word in WORDS:
    if word in cache and cache[word].get('tlfiAvailable') and cache[word].get('pronunciationExcerpt') and cache[word].get('selectedTlfiEntry',0)==ENTRY_INDEX.get(word,0):
        rows.append(cache[word])
        continue
    pos=POS.get(word,'')
    url='https://www.portail-lexical.fr/api/word/'+quote(word)+'/'+pos
    try:
        result=json.load(urlopen(url,timeout=25)); head=result.get('header',{})
        tlfi=next((x['content'] for x in result.get('content',[]) if x['id']=='tlfi'),[])
        selected=ENTRY_INDEX.get(word,0)
        entry=tlfi[selected] if tlfi else ''
        clean=html.unescape(re.sub('<[^>]+>',' ',entry))
        clean=re.sub(r'\s+',' ',clean)
        match=re.search(r'Prononciation(?: et orthographe)?',clean)
        excerpt=' '.join(clean[match.end():].split()[:22]) if match else None
        row=dict(word=word,source='ATILF public lookup; TLFi section',lookupUrl=url,
            referenceUrl='https://www.portail-lexical.fr/definition/tlfi/'+quote(word)+('/'+pos if pos else ''),
            headerForm=head.get('full_form'),headerIpa=head.get('ipa'),
            tlfiAvailable=bool(tlfi),pronunciationExcerpt=excerpt,
            selectedTlfiEntry=selected,tlfiEntryCount=len(tlfi),status='read')
        if not tlfi: row['otherEntries']=head.get('others',[])
    except HTTPError as error:
        if error.code==429:
            save()
            raise SystemExit('Stopped on rate limit; do not retry automatically.')
        row=dict(word=word,status='not-read',error=str(error))
    rows.append(row);save()
    print(word,row.get('headerIpa'),row.get('headerForm'),row.get('pronunciationExcerpt'),flush=True)
    time.sleep(.25)
expected={w[0]:w[1] for c in CANDIDATES for p in c['pairs'] for w in p}
for row in rows:
    # Historical TLFi symbols and predictable length are normalized explicitly.
    # This is a source-text comparison, not a claim about any generated audio.
    def broad(value):
        return value.replace('ʀ','ʁ').replace('ε','ɛ').replace('ɳ','ɲ').replace('g','ɡ').replace('oe','œ').replace(':','').replace('ː','')
    tokens=re.findall(r'\[([^\]]+)\]',row.get('pronunciationExcerpt') or '')
    row['dictionaryBroadIpaCandidates']=[broad(t) for t in tokens]
    row['editorialBroadIpa']=expected[row['word']]
    row['broadIpaMatchesRetrievedExcerpt']=expected[row['word']] in row['dictionaryBroadIpaCandidates']
    row['normalization']='TLFi ʀ→ʁ, ε→ɛ, ɳ→ɲ, g→ɡ, oe→œ; colon/length mark omitted for broad teaching notation. All other symbols preserved.'
save()
