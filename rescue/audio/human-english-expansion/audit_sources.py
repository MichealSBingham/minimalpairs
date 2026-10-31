#!/usr/bin/env python3
"""Summarize the bounded source search, without turning discovery into approval."""
import json,pathlib,re
from datetime import datetime,timezone
BASE=pathlib.Path(__file__).resolve().parent
def read(name):return json.loads((BASE/name).read_text())
def write(name,value):(BASE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
request=json.loads((BASE.parent.parent/'content/english-legacy-batch1-audio-request.json').read_text())
coverage=read('sources/coverage.json');legacy=read('sources/legacy-metadata.json')['query']['pages'].values()
identified={name:set(coverage['speakers'][name])for name in['Grendelkhan','Wodencafe','Vealhurl']}
identified['Dvortygirl']={p['title'].removeprefix('File:En-us-').removesuffix('.ogg')for p in legacy if 'imageinfo'in p and 'Dvortygirl'in p['imageinfo'][0]['extmetadata'].get('Artist',{}).get('value','')}
matrix=[]
for contrast in request['allNewContrastPairs']:
 words={w for pair in contrast['pairs']for w in pair}
 matrix.append({'contrastId':contrast['id'],'requestedPairs':contrast['pairs'],'requestedWords':sorted(words),'contributors':[{'name':name,'sourceIdentifiedWords':sorted(words&have),'missingWordsInBoundedSearch':sorted(words-have),'completeWordCoverage':words<=have}for name,have in identified.items()]})
entries={p['title']:p for p in read('sources/wiktionary-entry-pronunciations.json')['query']['pages'].values()}
variants=[]
for word in ['version','virgin']:
 entry=entries[word];revision=entry['revisions'][0];wiki=revision['slots']['main']['*'];section=wiki.split('===Pronunciation===',1)[1].split('\n===',1)[0]
 variants.append({'word':word,'url':f'https://en.wiktionary.org/w/index.php?title={word}&oldid={revision["revid"]}','revisionId':revision['revid'],'relevantDeclarations':[line for line in section.splitlines()if '|a=GA'in line or '{{audio|en|'in line],'audioListeningPerformed':False})
audit={'checkedAt':datetime.now(timezone.utc).isoformat(),'requestFile':'rescue/content/english-legacy-batch1-audio-request.json','scope':'17 exact forms across three requested English contrasts; no substitutions or phrase cropping','matrix':matrix,'boundedLinguaLibreQueries':coverage['boundedSearchTotals'],
 'broaderAudioQueries':{w:{'totalHits':read('sources/broader-audio-search-'+w+'.json')['query']['searchinfo']['totalhits'],'retrieved':len(read('sources/broader-audio-search-'+w+'.json')['query']['search'])}for w in['pledger','putt','buck','look','lesion']},
 'sourcePhoneticContext':variants,'holds':[
  {'word':'virgin','file':'File:En-us-virgin.ogg','reason':'The source places the US audio beneath GA /ˈvɝd͡ʒɪn/, not the required /ˈvɝdʒən/. Do not mark it a matching stimulus without a contrary listening review. It was not acquired or included.'},
  {'word':'pledger','reason':'No exact Lingua Libre hit; broader Commons audio search returned zero; Wiktionary entry contains no audio declaration. This is bounded search evidence, not proof no recording exists anywhere.'},
  {'word':'putt','file':'File:En-us-putt from the rough.oga','reason':'Source explicitly identifies an entire phrase. It was not downloaded, cropped or relabeled as an isolated putt.'},
  {'words':['lesion','legion'],'speaker':'Vealhurl','reason':'Exact Wiktionary audio references label the recordings Southern England; no matched two-speaker General American set was located.'},
  {'word':'look','files':['File:En-us-look (2).ogg','File:En-us-look (3).ogg'],'reason':'Alternate US files exist, but they do not complete either selected contributor profile; no substitution into Dvortygirl or Grendelkhan identity.'}],
 'dialectEvidence':{'Dvortygirl':'US in exact Commons file descriptions; relevant Wiktionary files labeled GA or US; native English self-declaration. Acoustic suitability not verified.','Grendelkhan':'Native English self-declaration on Commons; English Q1860 and credited contributor in exact files. No regional-accent declaration established.','Wodencafe':'Exact files identify English and contributor; reviewed public profiles do not establish native or regional accent.','Vealhurl':'The consulted Wiktionary entries label relevant files Southern England. This is source evidence, not a new listening judgment.'},
 'selectedAcquisition':{'contrastId':'en-ae-strut','pairs':[['cat','cut'],['cap','cup'],['lack','luck']],'contributors':['Grendelkhan','Dvortygirl'],'plannedClips':12,'completeSourceWordCoverage':True,'generalAmericanEvidenceCompleteForBothProfiles':False},
 'limitations':['Source-identified word coverage is not phonetic approval.','The sources do not establish identical recording conditions within a credited speaker.','Searches were bounded; look broader search had 103 total hits and retained the first100. Other exact Lingua Libre word queries were below the100 result cap.','No humans were contacted, no paid services used, no human voice cloned, no app/default manifest modified.']}
write('source-coverage-audit.json',audit)
print(json.dumps({'contrasts':len(matrix),'selectedContrast':'en-ae-strut','otherContrastsComplete':False,'conditionalVirginExcluded':True}))
