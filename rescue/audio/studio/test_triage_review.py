import unittest
from triage_review import classify
class TriageTests(unittest.TestCase):
 def check(self,text,heard,flags=None,bank='en-US-ga',sha='a'):
  return classify(dict(text=text,bank=bank,sha='a',flags=[]),dict(sha=sha,transcript=heard,flags=flags or ['asr_text_mismatch']),'a')
 def test_alias(self):self.assertEqual(self.check('bee','Be.')[0],'lower')
 def test_number(self):self.assertEqual(self.check('three','3')[0],'lower')
 def test_repeated_spelling(self):self.assertEqual(self.check('seem','Seam. Seam.')[0],'high')
 def test_multitoken(self):self.assertEqual(self.check('pea','Uh, pee.')[0],'high')
 def test_real_mismatch(self):self.assertEqual(self.check('thin','Sin.')[0],'high')
 def test_stale(self):self.assertEqual(self.check('bee','Be.',sha='old')[0],'needs_audit')
 def test_wrong_bank(self):self.assertEqual(self.check('bee','Be.',bank='fr')[0],'high')
 def test_repetition_flag_wins(self):self.assertEqual(self.check('bee','be',['asr_text_mismatch','asr_repeated_word'])[0],'high')
 def test_preserves_flags(self):self.assertEqual(self.check('bee','be')[2],['asr_text_mismatch'])
 def test_low_confidence_mismatch(self):self.assertEqual(self.check('bed','bad',['asr_low_confidence'])[0],'high')
 def test_low_confidence(self):self.assertEqual(self.check('bed','bed',['asr_low_confidence'])[0],'lower')
if __name__=='__main__':unittest.main()
