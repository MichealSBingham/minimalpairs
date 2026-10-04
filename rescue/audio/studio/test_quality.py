import unittest,tempfile
from pathlib import Path
import numpy as np
import soundfile as sf
from quality import measure,absolute_flags,relative_outlier
class SignalChecks(unittest.TestCase):
    def test_silence_and_clipping(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'clip.wav';sf.write(p,np.zeros(24000),24000)
            self.assertIn('silent_or_nearly_empty',absolute_flags(measure(p)))
            sf.write(p,np.ones(24000),24000)
            self.assertIn('sustained_clipping',absolute_flags(measure(p)))
    def test_internal_pause_and_normal_variation(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'clip.wav';tone=.2*np.sin(2*np.pi*220*np.arange(12000)/24000)
            sf.write(p,np.r_[tone,np.zeros(14400),tone],24000)
            self.assertIn('internal_pause',absolute_flags(measure(p)))
            sf.write(p,tone,24000);self.assertEqual(absolute_flags(measure(p)),[])
    def test_relative_needs_peers_and_large_deviation(self):
        self.assertTrue(relative_outlier(3,[.5,.55,.6,3]))
        self.assertFalse(relative_outlier(.7,[.5,.55,.6,.7]))
        self.assertFalse(relative_outlier(3,[.5,3]))
class DecisionChecks(unittest.TestCase):
    def test_decisions_are_hash_bound_and_undo_is_recorded(self):
        import quality,hashlib
        with tempfile.TemporaryDirectory() as d:
            old=quality.PRIVATE;quality.PRIVATE=Path(d)
            try:
                audio=Path(d)/'x.wav';audio.write_bytes(b'original');clip={'id':'test','path':str(audio),'sha':hashlib.sha256(b'original').hexdigest()}
                quality.record_decision(clip,clip['sha'],'pass');quality.record_decision(clip,clip['sha'],'unreviewed')
                db=quality.database();self.assertEqual([r['decision'] for r in db.execute('select * from decisions order by sequence')],['pass','unreviewed']);db.close()
                audio.write_bytes(b'replacement')
                with self.assertRaises(ValueError):quality.record_decision(clip,clip['sha'],'pass')
                db=quality.database();self.assertEqual(db.execute('select count(*) from decisions').fetchone()[0],2);db.close()
            finally:quality.PRIVATE=old
if __name__=='__main__':unittest.main()
