"""Stage only the five words missing a second voice after October 31 owner rejections."""
import json,fcntl,time
import studio as s
import quality as q
import audit_layer2 as l2
import replace_us_voice_a as batch
out=s.STATE/'coverage-replacements-2026-10-31';out.mkdir(exist_ok=True)
plan=json.loads((batch.RUN/'plan.json').read_text())
words={'coat','cot','cup','feet','frill'}
jobs=[j for j in plan['jobs'] if j['text'] in words]
assert len(jobs)==5
with (s.STATE/'.run.lock').open('a+') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 model=s.Chatterbox()
 for job in jobs:
  record=out/(job['id']+'.json')
  if record.exists():continue
  attempts=[]
  for n in range(3):
   render={k:v for k,v in job.items() if k!='publicTemplate'}
   render['seed']=(job['seed']+104729*(101+n))%2**32
   path=out/(job['id']+f'-{n}.wav');model.generate(render,path)
   metrics=q.measure(path);flags=q.absolute_flags(metrics);repeat=l2.repeated_bursts(path)
   if repeat.get('possibleRepeatedBurst'):flags.append('possible_repeated_burst')
   if metrics['duration']>2.2:flags.append('long_isolated_word')
   attempts.append({'path':str(path),'sha256':s.sha(path.read_bytes()),'seed':render['seed'],'flags':flags,'metrics':metrics,'repetition':repeat})
   if not flags:break
  record.write_text(json.dumps({'word':job['text'],'job':job,'attempts':attempts,'status':'ready-for-review' if not flags else 'needs-investigation','humanApproved':False,'published':False},indent=2))
  print(job['text'], 'ready-for-review' if not flags else 'needs-investigation',flush=True)
print('STAGING COMPLETE. No database or public recording replaced.',flush=True)
