import io
import unittest
import numpy as np
import soundfile as sf

from speaking_engine import SpeakingEngine, decode_recording
from speaking_server import REFS


class SpeakingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine=SpeakingEngine()
        ref=next(r for r in REFS.values() if r['speaker']=='Grendelkhan' and r['word']=='ship')
        cls.voice,_=decode_recording(ref['path'].read_bytes())

    def test_nonspeech_never_gets_a_point(self):
        t=np.arange(16000)/16000
        for x in (np.zeros(16000),np.random.default_rng(2).normal(0,.03,16000),
                  .1*np.sin(2*np.pi*220*t),np.clip(2*np.sin(2*np.pi*130*t),-1,1)):
            result=self.engine.analyze(x.astype('float32'))
            self.assertEqual(result['status'],'uncertain');self.assertIsNone(result['measurement'])

    def test_same_audio_has_no_word_or_grade_prediction(self):
        r=self.engine.analyze(self.voice)
        self.assertEqual(r['status'],'measured')
        self.assertIsNone(r['grade']);self.assertIsNone(r['predicted_word'])
        self.assertEqual(r['sampled_frames'],7)
        self.assertGreaterEqual(r['accepted_frames'],5)

    def test_quiet_prefix_recording_measures(self):
        x=np.r_[np.zeros(11200),self.voice,np.zeros(3200)].astype('float32')
        r=self.engine.analyze(x,600)
        self.assertEqual(r['status'],'measured')
        self.assertTrue(r['room_check'])

    def test_subframe_onset_shift_does_not_fail_duration_check(self):
        for shift in (0,40,80,120,159):
            x=np.r_[np.zeros(16000+shift),self.voice,np.zeros(16000)].astype('float32')
            r=self.engine.analyze(x,600)
            self.assertEqual(r['status'],'measured',f'shift={shift}: {r.get("reason")}')

    def test_early_speech_during_quiet_check_withheld(self):
        x=np.r_[self.voice,np.zeros(16000)].astype('float32')
        r=self.engine.analyze(x,600)
        self.assertEqual(r['reason'],'early_speech');self.assertIsNone(r['measurement'])

    def test_noisy_room_withheld(self):
        rng=np.random.default_rng(43)
        x=np.r_[np.zeros(11200),self.voice,np.zeros(3200)].astype('float32')
        x+=rng.normal(0,.015,len(x)).astype('float32')
        r=self.engine.analyze(x,600)
        self.assertEqual(r['status'],'uncertain');self.assertIsNone(r['measurement'])

    def test_two_words_withheld(self):
        x=np.r_[self.voice,np.zeros(4800),self.voice].astype('float32')
        r=self.engine.analyze(x)
        self.assertEqual(r['reason'],'multiple_regions')

    def test_decode_rejects_bad_and_excessive_inputs(self):
        with self.assertRaises(ValueError):decode_recording(b'not audio')
        for sr,duration in ((8000,1),(16000,7)):
            f=io.BytesIO();sf.write(f,np.zeros(sr*duration),sr,format='WAV')
            with self.assertRaises(ValueError):decode_recording(f.getvalue())

    def test_decode_stereo_and_resample(self):
        t=np.arange(44100)/44100;x=.1*np.sin(2*np.pi*440*t)
        f=io.BytesIO();sf.write(f,np.stack([x,x],axis=1),44100,format='WAV')
        y,sr=decode_recording(f.getvalue())
        self.assertEqual(len(y),16000);self.assertEqual(sr,44100)
        self.assertEqual(np.argmax(np.abs(np.fft.rfft(y))),440)


if __name__=='__main__':unittest.main()
