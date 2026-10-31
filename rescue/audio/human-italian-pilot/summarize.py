#!/usr/bin/env python3
"""Summarize cached primary evidence only; no network or media acquisition."""
import hashlib
import html
import json
import re
import urllib.parse
from datetime import datetime, timezone
from discover import BASE, write


def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', value))).strip()


def main():
    pages = []
    for name in ['bounded-known-profile-file-check.json', 'f-v-known-profile-file-check.json']:
        pages.extend(json.loads((BASE / 'sources' / name).read_text())['query']['pages'].values())
    assert len(pages) == 50 and len({p['title'] for p in pages}) == 50
    entities = json.loads((BASE / 'sources/strongest-files-mediainfo.json').read_text())['entities']
    exact = []
    profiles = {'LangPao': [], 'Happypheasant': []}
    for page in pages:
        match = re.fullmatch(r'File:LL-Q652 \(ita\)-(LangPao|Happypheasant)-(.+)\.wav', page['title'])
        assert match
        creator, word = match.groups()
        row = {'title': page['title'], 'profile': creator, 'word': word, 'exists': 'missing' not in page}
        if 'missing' not in page:
            info, revision = page['imageinfo'][0], page['revisions'][0]
            ext = info['extmetadata']
            wiki = revision['slots']['main']['*']
            entity = entities['M' + str(page['pageid'])]
            claims = entity.get('statements', entity.get('claims', {}))
            texts = [x['mainsnak'].get('datavalue', {}).get('value') for x in claims.get('P9533', [])]
            assert {'text': word, 'language': 'it'} in texts
            assert ext['LicenseShortName']['value'] == 'CC BY-SA 4.0'
            assert '{{cc-by-sa-4.0}}' in wiki.lower()
            assert not ext.get('Restrictions', {}).get('value', '')
            artist = clean(ext['Artist']['value'])
            assert 'Speaker: ' + creator in artist and 'Recorder: ' + creator in artist
            row.update({
                'sourcePage': 'https://commons.wikimedia.org/wiki/' + urllib.parse.quote(page['title'].replace(' ', '_'), safe=':()'),
                'sourceRevision': 'https://commons.wikimedia.org/w/index.php?' + urllib.parse.urlencode({'title': page['title'], 'oldid': revision['revid']}),
                'sourceRevisionId': revision['revid'], 'sourceRevisionTimestamp': revision['timestamp'],
                'mediaInfoRevisionId': entity['lastrevid'],
                'exactWordEvidence': {'property': 'P9533', 'text': word, 'language': 'it'},
                'creatorAttribution': artist, 'credit': clean(ext['Credit']['value']),
                'license': 'CC-BY-SA-4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/',
                'licenseEvidence': 'Exact file template and compiled metadata agree; no extra restriction listed',
                'sourceSha1': info['sha1'], 'sourceBytes': info['size'],
                'sourceUploadTimestamp': info['timestamp'],
                'sourceRecordingDate': clean(ext.get('DateTimeOriginal', {}).get('value', '')),
                'nativeAndRegionalStatus': 'not-established', 'downloaded': False,
                'decoded': False, 'phoneticListeningVerified': False, 'speakerConsistencyVerified': False,
            })
            profiles[creator].append(word)
        exact.append(row)
    assert sum(r['exists'] for r in exact) == 15
    contrasts = {
        'it-length': [['pala', 'palla'], ['fato', 'fatto'], ['pena', 'penna']],
        'it-p-b': [['panca', 'banca'], ['pasta', 'basta'], ['pelle', 'belle']],
        'it-f-v': [['fino', 'vino'], ['faro', 'varo'], ['finto', 'vinto']],
    }
    matrix = []
    for contrast, pairs in contrasts.items():
        for creator, present in profiles.items():
            matrix.append({'contrastId': contrast, 'profile': creator, 'present': sorted(set(sum(pairs, [])) & set(present)),
                           'missing': sorted(set(sum(pairs, [])) - set(present)),
                           'completePairs': [pair for pair in pairs if all(w in present for w in pair)]})
    assert all(len(r['completePairs']) < 2 for r in matrix)
    write(BASE / 'source-audit.json', {'checkedAt': datetime.now(timezone.utc).isoformat(),
          'filePagesChecked': 50, 'existingExactTextCreatorLicenseRecords': 15, 'missingExactTitles': 35,
          'records': exact, 'currentContrastCoverage': matrix,
          'limitation': 'Missing exact titles apply only to these two profile/filename conventions. Search negatives are bounded evidence, not proof of global absence. No media downloaded.'})
    discovery = json.loads((BASE / 'sources/coverage-discovery.json').read_text())
    assert len(discovery) == 19 and all(r['total'] == r['retrieved'] for r in discovery)
    write(BASE / 'coverage-search.json', {'wordSearches': discovery, 'truncatedQueries': 0,
          'filenameMatchesNotAllSourceVerified': True,
          'combinedFvQueryRejected': 'A combined OR query returned zero despite three directly confirmed files. It is not used as evidence of absence.',
          'knownProfiles': profiles, 'currentContrastCoverage': matrix,
          'proposedAlternativeStatus': 'No recording-complete alternative; no candidate curriculum or IPA approval issued.'})
    write(BASE / 'candidate-status.json', {'status': 'no-complete-two-pair-two-contributor-candidate',
          'selectedClips': 0, 'downloadedOriginals': 0, 'decodedClips': 0, 'stagedPairs': 0,
          'sourceMetadataRecordsChecked': 15, 'publicAudioChanged': False, 'mainCurriculumEdited': False,
          'phoneticListeningVerified': False, 'speakerConsistencyVerified': False})
    write(BASE / 'integration-inventory.json', {'collectionId': None, 'files': [], 'eligibleContrasts': [],
          'publicDeploymentApproved': False, 'defaultReplacementApproved': False,
          'reason': 'No defensible complete pool. No preview manifest or media is ready to integrate.'})
    evidence = [{'path': str(p.relative_to(BASE)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
                 'bytes': p.stat().st_size} for p in sorted((BASE / 'sources').glob('*.json'))]
    write(BASE / 'source-evidence-index.json', {'files': evidence, 'rawSourcesIgnored': True,
          'note': 'Hashes identify saved API evidence, not downloaded audio. No source waveform was acquired.'})
    result = {'exactFilePages': 50, 'sourceTextCreatorLicenseChecks': 15, 'searchQueries': 19,
              'completeTwoPairTwoProfilePools': 0, 'downloaded': 0, 'decoded': 0, 'publicChanges': 0}
    write(BASE / 'validation.json', {'status': 'passed-source-evidence-consistency-only', **result})
    print(json.dumps(result))


if __name__ == '__main__':
    main()
