"""Regression checks for promotion safety using isolated fixtures; never integrates live data."""
import contextlib,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import promote_us_voice_a as p

class PromotionGuards(unittest.TestCase):
 def run_case(self,missing=False,changed=False,one_voice=False):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);run=root/'run';run.mkdir();public=root/'manifest.json';data=root/'rescue/app/src/data';data.mkdir(parents=True)
   clips=[];jobs=[];pairs=[]
   for i in range(250):
    template={'wordId':str(i),'text':f'word{i}','ipa':f'ipa{i}'}
    jobs.append({'id':f'new{i}','publicTemplate':template})
    for voice in ('A',) if one_voice and i==0 else ('A','B'):
     clips.append({**template,'voiceId':'chatterbox-us-'+voice})
   public.write_text(json.dumps({'clips':clips}))
   plan={'jobs':jobs,'sourceManifestSHA256':p.s.sha(public.read_bytes())}
   (run/'plan.json').write_text(json.dumps(plan));(data/'us-chatterbox-curriculum.json').write_text(json.dumps({'contrasts':[{'pairs':[{'words':[{'text':'word0','ipa':'ipa0'},{'text':'word1','ipa':'ipa1'}]}]}]}))
   if changed:public.write_text(public.read_text()+' ')
   result={'sha256':'fakefixture','attempts':[{'sha256':'fakefixture','flags':[]}]}
   with patch.object(p.batch,'RUN',run),patch.object(p.batch,'PUBLIC',public),patch.object(p.s,'ROOT',root),patch.object(p.batch,'completed',return_value=None if missing else result),patch('sys.argv',['promote_us_voice_a.py']),contextlib.redirect_stdout(io.StringIO()):p.main()
 def test_complete_dry_run(self):self.run_case()
 def test_incomplete_is_blocked(self):
  with self.assertRaisesRegex(AssertionError,'incomplete'):self.run_case(missing=True)
 def test_changed_live_manifest_is_blocked(self):
  with self.assertRaisesRegex(AssertionError,'changed'):self.run_case(changed=True)
 def test_single_voice_is_blocked(self):
  with self.assertRaisesRegex(AssertionError,'two distinct'):self.run_case(one_voice=True)
if __name__=='__main__':unittest.main()
