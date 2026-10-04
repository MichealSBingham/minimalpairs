import unittest,tempfile
from pathlib import Path
import numpy as np
import soundfile as sf
from audit_layer2 import normalize,transcript_flags,repeated_bursts
class AuditTests(unittest.TestCase):
 def test_text(self):
  self.assertEqual(transcript_flags('Faim',' faim!'),[])
  self.assertEqual(transcript_flags('pin','pin pin'),['asr_repeated_word'])
  self.assertEqual(transcript_flags('pin','bin'),['asr_text_mismatch'])
  self.assertEqual(transcript_flags('妈','马'),['asr_text_mismatch'])
  self.assertEqual(transcript_flags('vu',''),['asr_empty'])
  self.assertNotEqual(normalize('pâte'),normalize('patte'))
 def test_repeat(self):
  sr=16000;t=np.arange(sr//2)/sr;x=np.sin(2*np.pi*(200*t+150*t*t))*np.hanning(len(t))
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'x.wav';sf.write(p,np.r_[x,np.zeros(sr//5),x],sr);self.assertTrue(repeated_bursts(p)['possibleRepeatedBurst'])
   sf.write(p,x,sr);self.assertFalse(repeated_bursts(p).get('possibleRepeatedBurst',False))
if __name__=='__main__':unittest.main()
