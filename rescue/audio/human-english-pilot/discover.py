#!/usr/bin/env python3
"""Bounded Commons discovery for the exact English starter vowel contrast."""
import collections, json, pathlib, re, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

BASE = pathlib.Path(__file__).resolve().parent
WORDS = ['ship', 'sheep', 'fill', 'feel', 'sit', 'seat']
HEADERS = {'User-Agent': 'MinimalPairsRescue/1.0 (public media provenance research; minimalpairs.co)'}

def api(params):
    url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({'format': 'json', **params})
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=40) as response:
        result = json.load(response)
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result

def cached(name, params):
    path = BASE / 'sources' / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return json.loads(path.read_text())
    result = api(params)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    time.sleep(1)
    return result

def main():
    coverage = collections.defaultdict(dict)
    totals = {}
    for word in WORDS:
        result = cached(f'search-{word}.json', {'action':'query', 'list':'search', 'srsearch':f'intitle:"LL-Q1860" intitle:"{word}.wav"', 'srnamespace':6, 'srlimit':100})
        hits = result['query']['search']
        totals[word] = {'totalHits': result['query']['searchinfo']['totalhits'], 'retrieved': len(hits), 'boundedAt':100}
        for hit in hits:
            match = re.fullmatch(r'File:LL-Q1860 \(eng\)-(.+)-' + re.escape(word) + r'\.wav', hit['title'])
            if match:
                coverage[match.group(1)][word] = hit['title']
    ranked = dict(sorted(coverage.items(), key=lambda item: (-len(item[1]), item[0])))
    summary = {'retrievedAt': datetime.now(timezone.utc).isoformat(), 'exactWords': WORDS, 'searchTotals': totals, 'speakers': ranked}
    (BASE / 'sources' / 'coverage.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'searchTotals':totals, 'speakerCoverage':{speaker:len(words) for speaker,words in ranked.items()}}, indent=2))

if __name__ == '__main__':
    main()
