#!/usr/bin/env python3
"""Publish candidate-specific credits and a pending listening-review template."""
import json, pathlib

BASE = pathlib.Path(__file__).resolve().parent

def main():
    m = json.loads((BASE/'manifest.candidate.json').read_text())
    records = [{
        'text':c['text'], 'voiceId':c['voiceId'], 'author':c['author'], 'title':c['sourceTitle'], 'sourcePage':c['sourcePage'],
        'sourceRevision':c['sourceRevision'], 'license':c['license']['id'], 'licenseUrl':c['license']['url'],
        'changes':c['changes'], 'sourceProject':c['sourceProject'], 'copyrightNotice':c['originalCopyrightNotice'],
        'additionalAttribution':c['additionalAttribution'], 'originalLicenseNotice':c['originalLicenseNotice'],
    } for c in m['clips']]
    (BASE/'attribution.json').write_text(json.dumps({'scope':'English human-recording candidate; not deployed','records':records},ensure_ascii=False,indent=2)+'\n')
    intro = '''# English human-recording pilot credits

These twelve recordings are credited to Grendelkhan and Dvortygirl through Wikimedia Commons. Neither contributor endorses MinimalPairs. Source metadata and licenses have been audited; word identity, target vowels, naturalness and accent suitability have not been approved by listening.

**Grendelkhan:** the six Lingua Libre recordings remain [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is retained voluntarily. They do not acquire a share-alike license from neighboring clips.

**Dvortygirl:** the six recordings are distributed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), one of the licenses explicitly offered on each source page. Retain the author, original title, source link, license, supplied notices and conversion notice. Copies retain this license; any further adaptations must comply with applicable share-alike terms. No additional legal or technological restrictions are attached to these recordings.

**Changes:** each original WAV (Grendelkhan) or Ogg Vorbis (Dvortygirl) file was converted to 192 kbps, 44.1 kHz mono MP3 with libmp3lame. Sample-rate conversion and stereo downmix were applied where needed; embedded metadata was removed. No trimming, denoising, loudness normalization, time stretching or pitch shifting was applied. Downmix can change channel balance. MP3 duration may include encoder padding. The per-file JSON records original sample rate/channel count and changes.

The original `fill` Ogg also credits **Betsy Megas** in its ARTIST field; that creator credit is retained alongside the source-page account credit. It contains the nonstandard license string “Creative Commons BY-CA”; the distribution license selected here is the explicit CC BY-SA 3.0 offer on the exact Commons file page. No alias or identity relationship is independently verified.

| Word | Credited speaker/creator | Original title and source | License |
|---|---|---|---|
'''
    rows = [f'| {r["text"]} | {r["author"]}' + (f'; original artist credit: {r["additionalAttribution"]}' if r['additionalAttribution'] else '') + f' | [{r["title"]}]({r["sourcePage"]}) | [{r["license"]}]({r["licenseUrl"]}) |' for r in records]
    (BASE/'ATTRIBUTION.md').write_text(intro+'\n'.join(rows)+'\n')
    ipa = {'ship':'/ʃɪp/','sheep':'/ʃip/','fill':'/fɪl/','feel':'/fil/','sit':'/sɪt/','seat':'/sit/'}
    review = {'purpose':'Pending human listening review. Engineering/source checks do not establish actual pronunciation or General American suitability.',
        'reviewer':None,'reviewedAt':None,'reviewerLanguageExperience':None,'clips':[
            {'voiceId':c['voiceId'],'word':c['text'],'expectedCurriculumIPA':ipa[c['text']],'sourcePage':c['sourcePage'],
             'listenedToWholeClip':False,'wordIdentityCorrect':None,'targetContrastCorrect':None,'generalAmericanSuitable':None,
             'addedOrMissingSpeech':None,'naturalnessAcceptable':None,'speakerConsistencyAcceptable':None,'notes':'','decision':'pending'} for c in m['clips']]}
    path = BASE/'listening-review.template.json'
    if not path.exists():
        path.write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n')
    print('Wrote twelve per-file credits; listening review remains pending.')

if __name__ == '__main__':
    main()
