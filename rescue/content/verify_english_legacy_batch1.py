"""Read bounded dictionary pronunciation facts; never copy source audio/prose.

Cambridge US blocks are parsed structurally to preserve nested IPA spans.
For pledger/version/virgin, separately read American Collins entries are recorded.
"""
import json
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request,urlopen

ROOT=Path(__file__).resolve().parent
PATH=ROOT/'english-legacy-batch1-source-audit.json'
DATA=json.loads((ROOT/'english_legacy_batch1.json').read_text())
EXPECTED={w[0]:w[1] for c in DATA for p in c['pairs'] for w in p}

class CambridgeUS(HTMLParser):
    def __init__(self):
        super().__init__();self.us=0;self.ipa=0;self.buffer=[];self.tokens=[]
    def handle_starttag(self,tag,attrs):
        if tag!='span':return
        classes=dict(attrs).get('class','').split()
        if self.us:self.us+=1
        elif 'us' in classes and 'dpron-i' in classes:self.us=1
        if self.ipa:self.ipa+=1
        elif self.us and 'ipa' in classes:self.ipa=1;self.buffer=[]
    def handle_endtag(self,tag):
        if tag!='span':return
        if self.ipa:
            self.ipa-=1
            if not self.ipa:self.tokens.append(''.join(self.buffer).strip())
        if self.us:self.us-=1
    def handle_data(self,value):
        if self.ipa:self.buffer.append(value)

def broad(ipa):
    return ipa.replace('ː','').replace('.','').replace('·','').replace('e','ɛ').replace('ɜr','ɝ').replace('ər','ɚ').replace('r','ɹ')

cache={r['word']:r for r in json.loads(PATH.read_text())['words']} if PATH.exists() else {}
rows=[]
def save():
    PATH.write_text(json.dumps(dict(date='2026-09-28',
        limitation='Dictionary facts and broad-notation matching do not validate generated audio. Cambridge US pronunciation blocks only; selected Collins Webster’s New World American entries for pledger/version/virgin. No dictionary recordings or definition paragraphs are copied.',
        words=rows,
        excludedCandidates=[
            dict(pair=['leisure','ledger'],reason='Cambridge primary US leisure is /ˈliː.ʒɚ/; Collins American ledger is /ˈlɛdʒər/. This would also change the stressed vowel. A secondary American /ɛ/ variant of leisure exists, but is not silently imposed on this starter.',sources=['https://dictionary.cambridge.org/dictionary/english/leisure','https://www.collinsdictionary.com/us/dictionary/english/ledger']),
            dict(pair=['lesions','legions'],reason='Regular plurals would add no independent lexical frames. Not used merely to inflate the sparse contrast count.',sources=['https://dictionary.cambridge.org/dictionary/english/lesion','https://dictionary.cambridge.org/dictionary/english/legion'])
        ],
        conditionalPair=dict(pair=['version','virgin'],selectedReading='Shared final schwa: /ˈvɝʒən–ˈvɝdʒən/. Both selected transcriptions occur in Webster’s New World American entries on Collins.',
            caution='Another American entry on the same virgin page gives final /ɪ/. That variant would add a vowel difference. Version also has a voiceless /ʃ/ variant; it is not the target here. Audio review must select the explicitly authored readings.',
            sources=['https://www.collinsdictionary.com/us/dictionary/english/version','https://www.collinsdictionary.com/us/dictionary/english/virgin'])
        ),ensure_ascii=False,indent=2)+'\n')
for word,ipa in EXPECTED.items():
    if word in ['pledger','version','virgin']:
        row=dict(word=word,source='Webster’s New World College Dictionary via Collins, explicitly American English',
            referenceUrl='https://www.collinsdictionary.com/us/dictionary/english/'+word,
            supportingUrls=['https://www.merriam-webster.com/dictionary/pledger'] if word=='pledger' else [],
            retrievedUsIpa={'pledger':['ˈplɛdʒər'],'version':['ˈvɜrʒən','ˈvɜrʃən'],'virgin':['ˈvɜrdʒən']}[word],
            retrieval='American entry read through web tool on 2026-09-28; dictionary edition identified separately from other entries on the same page.',status='pronunciation-read')
    elif word in cache and cache[word].get('status')=='pronunciation-read':row=cache[word]
    else:
        url='https://dictionary.cambridge.org/dictionary/english/'+word
        try:
            response=urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=25)
            parser=CambridgeUS();parser.feed(response.read().decode('utf-8'))
            row=dict(word=word,source='Cambridge Dictionary, US pronunciation blocks',referenceUrl=url,
                retrievedUsIpa=list(dict.fromkeys(parser.tokens)),status='pronunciation-read' if parser.tokens else 'no-us-ipa-retrieved')
        except HTTPError as error:
            if error.code==429:save();raise SystemExit('Stopped on rate limit; do not retry automatically.')
            row=dict(word=word,referenceUrl=url,status='not-read',error=str(error))
        time.sleep(.25)
    row['editorialBroadIpa']=ipa
    row['dictionaryBroadIpaCandidates']=[broad(p) for p in row.get('retrievedUsIpa',[])]
    row['broadIpaMatchesRetrievedUs']=ipa in row['dictionaryBroadIpaCandidates']
    row['normalization']='Cambridge /e/ is represented as DRESS /ɛ/; /iː/ as /i/; syllable dots removed; rhotic /ər/ written /ɚ/ and /ɜr/ as /ɝ/. Stress preserved. These are declared broad-notation equivalents, not audio modifications.'
    rows.append(row);save()
    print(word,row.get('retrievedUsIpa'),row['broadIpaMatchesRetrievedUs'],flush=True)
save()
