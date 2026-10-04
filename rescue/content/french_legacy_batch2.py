"""Second bounded French legacy restoration, using checked TLFi lexemes."""
import json
import unicodedata
from pathlib import Path

ROOT=Path(__file__).resolve().parent
NASAL_SOURCE='https://doi.org/10.1017/S0959269523000212'
PERCEPTION_SOURCE='https://pubmed.ncbi.nlm.nih.gov/19894844/'
DESCRIPTION={
    'fr-y-i':'Compare the rounded vowel /y/ with unrounded /i/. Every example has one vowel, so keep that vowel as the target when the consonants change.',
    'fr-y-oe':'Both vowels are rounded and front. Compare close /y/ with close-mid /ø/ in word-final position; neither category is schwa.',
    'fr-u-oe':'Compare back /u/ with front close-mid /ø/. Both categories are rounded vowels, so rounded lips alone do not identify the answer.',
    'fr-e-oe':'Compare unrounded /e/ with rounded /ø/ in the last sound of each word. These are close-mid vowels; the open-mid vowels /ɛ/ and /œ/ have a separate lesson.',
    'fr-eh-eu-open':'Compare the open-mid vowels /ɛ/ and /œ/ immediately before the final French r. The main category difference is the rounded vowel in peur, sœur and heure.',
    'fr-d-t':'Match the first consonant: voiced /d/ or voiceless /t/. The following vowel changes across pairs and stays the same within each pair.',
    'fr-g-k':'Compare the first consonant /ɡ/ with /k/. Both are stops made toward the back of the mouth; listen to the contrast across several vowel frames.',
    'fr-v-f':'Compare the voiced /v/ with voiceless /f/ at the start. The first sound is the target whether the following vowel is oral or nasal.',
    'fr-b-v':'Compare the brief stop /b/ with continuous fricative /v/ at the beginning. These are different French sound categories even when the letters work differently in your first language.',
    'fr-sh-s':'Compare /ʃ/ with /s/ at the beginning. Both are voiceless fricatives; listen for the difference in the noise, not for a change in voicing.',
    'fr-l-r':'Compare initial /l/ with the metropolitan French rhotic, written /ʁ/ here. The shared vowel or ending stays the same within each pair.',
    'fr-n-gn':'Compare the final n with the final gn category, conventionally written /ɲ/. Its realization varies by speaker and region; these are broad dictionary labels, not a claim of one universal articulation.',
}
NOTES={
    'fr-e-oe':{'pré':'Preux is an established but less frequent adjective and noun. Knowing its meaning is not required for the listening task.'},
    'fr-eh-eu-open':{'père':'Historical dictionary notation can mark pre-r vowel length; the curriculum shows broad vowel categories. Both members retain their natural timing.'},
    'fr-sh-s':{'choix':'Some older or regional descriptions use /ɑ/ in these words. This lesson selects recordings with the same /a/ category in both words.'},
    'fr-n-gn':{'peine':'No final schwa is added to the selected citation forms. All three pairs target the word-final nasal consonant.'},
}

def slug(word):
    return ''.join(c for c in unicodedata.normalize('NFKD',word.replace('œ','oe')) if not unicodedata.combining(c))

def add_french_legacy_batch2(languages,contrast,pair,fr_source):
    candidates=json.loads((ROOT/'french_legacy_batch2_candidates.json').read_text())
    checked={row['word']:row for row in json.loads((ROOT/'french-legacy-batch2-source-audit.json').read_text())['words']}
    added=[]
    for item in candidates:
        pairs=[]
        for a,b in item['pairs']:
            for word in [a,b]:
                evidence=checked[word[0]]
                assert evidence.get('tlfiAvailable') and evidence.get('pronunciationExcerpt'), f'Missing TLFi pronunciation evidence: {word[0]}'
                assert evidence.get('broadIpaMatchesRetrievedExcerpt') and evidence.get('editorialBroadIpa')==word[1], f'IPA differs from checked source facts: {word[0]}'
            sources=[checked[a[0]]['referenceUrl'],checked[b[0]]['referenceUrl']]
            note=NOTES.get(item['id'],{}).get(a[0])
            pairs.append(pair('fr-'+slug(a[0])+'-'+slug(b[0]),tuple(a),tuple(b),sources,note=note))
        sources=[fr_source]
        if item['id']=='fr-n-gn': sources.append(NASAL_SOURCE)
        if item['id'] in ['fr-y-i','fr-eh-eu-open']: sources.append(PERCEPTION_SOURCE)
        c=contrast(item['id'],item['label'],item['phonemes'],DESCRIPTION[item['id']],pairs,sources)
        c['dialect']='Metropolitan French citation forms without final schwa; broad /ɲ/ convention with regional variation' if item['id']=='fr-n-gn' else 'Metropolitan French citation forms'
        added.append(c)
    next(l for l in languages if l['id']=='fr')['contrasts'].extend(added)
