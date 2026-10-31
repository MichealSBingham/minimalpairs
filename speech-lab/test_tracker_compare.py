import unittest
import numpy as np
from tracker_compare import prepare_audio, input_gate, estimates, CEILINGS
from run_tracker_comparison import read_corpus, metrics, canonical


class TrackerTests(unittest.TestCase):
    def test_resampling_preserves_time_and_tone(self):
        for sr in (16000,44100,48000):
            x=.1*np.sin(2*np.pi*440*np.arange(sr)/sr)
            y=prepare_audio(x,sr)
            self.assertEqual(len(y),16000)
            peak=np.argmax(np.abs(np.fft.rfft(y)))
            self.assertEqual(peak,440)

    def test_invalid_audio_rejected(self):
        for x in ([],[np.nan],np.zeros((100,2))):
            with self.assertRaises(ValueError):prepare_audio(x,16000)

    def test_non_speech_controls_withheld(self):
        t=np.arange(16000)/16000
        controls=[np.zeros(16000),.1*np.sin(2*np.pi*220*t),
                  np.random.default_rng(1).normal(0,.03,len(t)),
                  np.clip(2*np.sin(2*np.pi*130*t),-1,1)]
        for x in controls:self.assertFalse(input_gate(x)[0])

    def test_neural_disagreement_abstains_without_hiding_raw(self):
        bank={c:np.array([500.,1500.]) for c in CEILINGS}
        r=estimates(bank,np.array([600.,2500.]))
        self.assertFalse(r['cross_method_fixed']['accepted'])
        self.assertIsNotNone(r['cross_method_fixed']['f2'])
        self.assertFalse(r['cross_method_multiceiling']['accepted'])

    def test_reference_columns_match_existing_midpoints(self):
        import json
        from tracker_compare import ROOT
        prior=json.loads((ROOT.parent/'accuracy-lab/data/hillenbrand/benchmark-clips.json').read_text())
        corpus,_=read_corpus();new={c['id']:c for c in corpus}
        differences = {}
        for p in prior:
            ref=next(r for r in new[canonical(p['id'])]['references'] if r['fraction']==.5)
            if (ref['f1'], ref['f2']) != (p['ref_f1'], p['ref_f2']):
                differences[p['id']] = (ref['f1'], ref['f2'])
        # The old clips used vowdata.dat. Four records differ in bigdata.dat;
        # preserve this explicit source discrepancy instead of silently mixing.
        self.assertEqual(differences, {'b02iy': (482.,3155.),
            'b13er': (554.,1700.), 'g08iy': (489.,3092.), 'w49eh': (638.,2083.)})
        example = new['b01ae']['references']
        self.assertEqual([(r['fraction'],r['f1'],r['f2']) for r in example],
                         [(.2,651.,2413.),(.5,683.,2295.),(.8,806.,2049.)])

    def test_abstentions_reduce_yield(self):
        rows=[{'speaker':'a','reference':{'f1':500,'f2':1500},
               'methods':{'m':{'accepted':True,'f1':500,'f2':1500}}},
              {'speaker':'b','reference':{'f1':500,'f2':1500},
               'methods':{'m':{'accepted':False,'f1':None,'f2':None}}}]
        r=metrics(rows,'m')
        self.assertEqual(r['coverage'],.5)
        self.assertEqual(r['good_measurement_yield'],.5)
        self.assertEqual(r['large_error_rate'],0.)


if __name__=='__main__':unittest.main()
