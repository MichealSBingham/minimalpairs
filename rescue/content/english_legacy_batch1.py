"""English restoration selected from observed legacy search demand."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
DESCRIPTION={
    'en-zh-j':'Compare the continuous voiced sound /ʒ/ with the voiced affricate /dʒ/ between vowels. The three pairs use selected American readings; version and virgin share a final schwa in this lesson. A small practiced inventory does not establish unseen-word transfer.',
    'en-foot-strut':'Compare the stressed vowels /ʊ/ and /ʌ/ in General American English. Put, look and book share the first category; putt, luck and buck share the second. This is a vowel-quality contrast, not a short-versus-long rule.',
    'en-ae-strut':'Compare the stressed vowel /æ/ with /ʌ/ in short words. Each reference pair keeps its first and last consonants; X uses a different word frame with the same target vowel category.',
}

def add_english_legacy_batch1(languages,contrast,pair,en_source):
    data=json.loads((ROOT/'english_legacy_batch1.json').read_text())
    checked={r['word']:r for r in json.loads((ROOT/'english-legacy-batch1-source-audit.json').read_text())['words']}
    added=[]
    for item in data:
        examples=[]
        for a,b in item['pairs']:
            for word in [a,b]:
                evidence=checked[word[0]]
                assert evidence.get('broadIpaMatchesRetrievedUs') and evidence['editorialBroadIpa']==word[1], f'Missing checked US pronunciation: {word[0]}'
            sources=[checked[a[0]]['referenceUrl'],checked[b[0]]['referenceUrl']]
            sources.extend(checked[b[0]].get('supportingUrls',[]))
            note='Pledger is a real but less frequent noun: a person giving a pledge. Both words have first-syllable stress and a rhotic final vowel in this American reference.' if b[0]=='pledger' else None
            if b[0]=='virgin':note='This pair selects the shared final-schwa American readings documented in Webster’s New World. Other dictionaries also give /ɪ/ in virgin; that reading would add a vowel difference. Version must use /ʒ/, not its /ʃ/ variant. Review both clips for this specific pair.'
            examples.append(pair('en-'+a[0]+'-'+b[0],tuple(a),tuple(b),sources,note=note))
        c=contrast(item['id'],item['label'],item['phonemes'],DESCRIPTION[item['id']],examples,[en_source])
        c['dialect']='General American citation forms; shared final schwa in version/virgin' if item['id']=='en-zh-j' else 'General American citation forms'
        if item.get('inventoryLimitation'):c['inventoryLimitation']=item['inventoryLimitation']
        added.append(c)
    next(l for l in languages if l['id']=='en')['contrasts'].extend(added)
