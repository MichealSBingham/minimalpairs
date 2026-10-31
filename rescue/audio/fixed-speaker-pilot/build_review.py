#!/usr/bin/env python3
"""Create an unfilled listening worksheet. No review decisions are inferred."""
import html,json,pathlib,random
HERE=pathlib.Path(__file__).resolve().parent
def esc(value):return html.escape(str(value),quote=True)
refs=json.loads((HERE/'references.json').read_text())['references']
clips=json.loads((HERE/'take-inventory.json').read_text())['clips']
ordered=clips.copy();random.Random(9282026).shuffle(ordered)
template={'collection':'fixed-speaker-pilot-v1','status':'not-listened','reviewer':None,'reviewedAt':None,
    'reviewerLanguageExperience':None,'deviceAndHeadphones':None,'presentationSeed':9282026,
    'phoneticListeningVerified':False,'speakerConsistencyVerified':False,
    'instructions':['Listen before revealing the requested word or transcript. Write what you actually hear.',
        'Judge exact word and contrast separately from pleasantness and apparent speaker identity.',
        'Compare each profile with its reference and with all six words. Report changes, ambiguity, or uncertainty.',
        'Mark added sounds, missing word segments, repetition, abnormal padding, noise, distortion or speech cutoffs.',
        'A failed or uncertain required word blocks promotion of the affected complete contrast/profile set.',
        'The study does not test learning gains or generalization. No decision is prefilled.'],
    'references':[{'profileKey':r['profileKey'],'voiceId':r['voiceId'],'path':r['privateWavPath'],
        'sha256':r['referenceSha256'],'requestedTranscript':r['referenceText'],'heardTranscript':None,
        'wordAccuracy':'not-reviewed','accentAssessment':None,'audioArtifacts':None,'notes':None} for r in refs],
    'clips':[{'blindLabel':f'C{i+1:03d}','id':c['id'],'path':'clips/'+pathlib.Path(c['url']).name,
        'languageId':c['languageId'],'voiceId':c['voiceId'],'take':c['take'],'sha256':c['sha256'],
        'requestedWord':c['text'],'targetIPA':c['targetIPA'],'heardWord':None,
        'wordAccuracy':'not-reviewed','targetContrast':'not-reviewed','sameSpeakerAsReference':'not-reviewed',
        'artifacts':None,'decision':'not-reviewed','notes':None} for i,c in enumerate(ordered)],
    'profileJudgments':[{'voiceId':r['voiceId'],'consistentAcrossWordsAndTakes':'not-reviewed',
        'distinctFromOtherLanguageProfile':'not-reviewed','dialectSuitability':'not-reviewed','notes':None} for r in refs]}
(HERE/'listening-review.template.json').write_text(json.dumps(template,ensure_ascii=False,indent=2)+'\n')
cards=[]
for entry in template['references']:
    cards.append(f'<article><h3>Reference {esc(entry["profileKey"])}</h3><audio controls preload="none" src="{esc(entry["path"])}"></audio><details><summary>Reveal requested transcript</summary><p>{esc(entry["requestedTranscript"])}</p></details><p class="small">{esc(entry["voiceId"])}</p></article>')
rows=[]
options='<option>not-reviewed</option><option>pass</option><option>fail</option><option>uncertain</option>'
for entry in template['clips']:
    idx=entry['blindLabel']
    rows.append(f'''<article class="clip" data-id="{esc(entry['id'])}"><div class="title"><h3>{idx} · {esc(entry['languageId'].upper())}</h3><span class="small">Take {entry['take']+1}</span></div>
<audio controls preload="none" src="{esc(entry['path'])}"></audio>
<label>What did you hear?<input data-field="heardWord" autocomplete="off"></label>
<details><summary>Reveal requested word and profile</summary><p><strong>{esc(entry['requestedWord'])}</strong> · {esc(entry['targetIPA'])}</p><p class="small">{esc(entry['voiceId'])}</p></details>
<div class="ratings"><label>Word accuracy<select data-field="wordAccuracy">{options}</select></label><label>Target contrast<select data-field="targetContrast">{options}</select></label><label>Same speaker as reference<select data-field="sameSpeakerAsReference">{options}</select></label><label>Overall decision<select data-field="decision">{options}</select></label></div>
<label>Artifacts / uncertainty / notes<textarea data-field="notes" rows="2"></textarea></label></article>''')
data=json.dumps(template,ensure_ascii=False).replace('</',r'<\/')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixed reference audio · listening worksheet</title>
<style>body{font:16px/1.55 system-ui,sans-serif;background:#f5f6fa;color:#14253b;margin:0}main{max-width:1060px;margin:40px auto;padding:0 22px 60px}h1{font-size:2.2rem;line-height:1.15}h2{margin-top:36px}h3{margin:0;font-size:1.05rem}p{max-width:800px}.badge{background:#ffedcf;display:inline-block;padding:5px 12px;border-radius:20px;font-weight:650}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px}article{background:white;border:1px solid #dce2ec;padding:20px;border-radius:16px;min-width:0}audio{width:100%;margin:15px 0}.small{font-size:.78rem;color:#52657a;overflow-wrap:anywhere}label{display:block;font-size:.85rem;font-weight:600;margin-top:13px}input,select,textarea{box-sizing:border-box;display:block;font:inherit;width:100%;border:1px solid #c5cedb;border-radius:7px;background:white;padding:8px;margin-top:4px}details{margin-top:15px}summary{cursor:pointer;color:#224f8c}.ratings{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.title{display:flex;align-items:center;justify-content:space-between}button{font:inherit;font-weight:650;color:white;background:#194b7e;border:0;border-radius:8px;padding:12px 18px;cursor:pointer}header{margin-bottom:26px}.actions{position:sticky;bottom:0;background:#f5f6faf5;padding:16px 0;border-top:1px solid #dce2ec}.actions p{font-size:.8rem;margin:6px 0} @media(max-width:500px){main{padding:0 14px 30px}.grid{grid-template-columns:1fr}h1{font-size:1.8rem}.ratings{grid-template-columns:1fr}}</style>
<main><header><span class="badge">Synthetic · not reviewed · private candidate</span><h1>Listen, then judge.</h1><p>This worksheet compares fixed reference conditioning across words and takes. Its labels do not establish native pronunciation, consistent speaker identity or learning effectiveness. Listen before opening the requested text.</p><p>No answers or approvals are prefilled. The browser does not upload responses. Download your notes before closing this page.</p><label>Reviewer<input id="reviewer"></label><label>Language experience and listening equipment<input id="experience"></label></header><h2>Four fictional reference voices</h2><p>Check that each reference actually says its supplied transcript before trusting it as conditioning. These are generated personas, not recordings of real people.</p><div class="grid">'''+''.join(cards)+'''</div><h2>Word takes in shuffled order</h2><p>Assess the word, its target contrast, audible identity against the reference, and any artifacts independently. An uncertain required item needs review before this set is used.</p><div class="grid">'''+''.join(rows)+'''</div><div class="actions"><button id="download">Download review notes</button><p>Downloading notes does not approve or deploy the collection. Changes are lost unless downloaded.</p></div></main><script type="application/json" id="template">'''+data+'''</script><script>const template=JSON.parse(document.querySelector('#template').textContent);document.querySelector('#download').onclick=()=>{const result=structuredClone(template);result.reviewer=document.querySelector('#reviewer').value||null;result.reviewerLanguageExperience=document.querySelector('#experience').value||null;result.reviewedAt=new Date().toISOString();result.status='review-notes-unadjudicated';document.querySelectorAll('.clip').forEach(node=>{const row=result.clips.find(c=>c.id===node.dataset.id);node.querySelectorAll('[data-field]').forEach(input=>row[input.dataset.field]=input.value||null)});const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='fixed-speaker-review-notes.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};</script></html>'''
(HERE/'review.html').write_text(page)
print(json.dumps({'reviewClips':len(ordered),'referenceCards':len(refs),'decisionsPrefilled':False}))
