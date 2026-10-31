#!/usr/bin/env python3
"""Prepare public-safe metadata locally; never copies anything to the application."""
import json,pathlib
HERE=pathlib.Path(__file__).resolve().parent
def read(name):return json.loads((HERE/name).read_text())
def write(name,value):(HERE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
manifest=read('manifest.candidate.json')
for clip in manifest['clips']:
    for key in ['privateReferencePath','privateWavPath']:clip.pop(key,None)
manifest['collectionId']='fixed-speaker-pilot-v1'
manifest['audioSourceKind']='synthetic-fixed-reference'
manifest['reviewNote']='Reusing the same reference input is verified. Audible speaker identity, requested text, accent and target contrast are not listening-verified.'
write('manifest.preview.json',manifest)
refs=read('references.json')
for ref in refs['references']:ref.pop('privateWavPath',None)
refs['transcriptStatus']='Exact supplied synthesis input; not a listening-verified transcript'
refs['rawReferenceAudioIncluded']=False
write('references.public-metadata.json',refs)
write('primary-files.json',{'collectionId':manifest['collectionId'],'total':len(manifest['clips']),
    'files':[{'relativePath':'clips/'+pathlib.Path(c['url']).name,'url':c['url'],'languageId':c['languageId'],
        'text':c['text'],'voiceId':c['voiceId'],'take':c['take'],'sha256':c['sha256']} for c in manifest['clips']],
    'excluded':['private/','review.html','all non-primary takes','raw reference WAVs','rejected and retired assets']})
print(json.dumps({'primaryMappings':len(manifest['clips']),'publicReferenceMetadata':len(refs['references']),'appFilesWritten':0}))
