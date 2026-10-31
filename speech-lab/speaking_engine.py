"""Experimental single-word measurements. No transcript, target or grade input."""
import io
import time

import numpy as np
import parselmouth
import soundfile as sf
import torch

from tracker_compare import HeatmapTracker, prepare_audio, input_gate, valid, AGREEMENT_HZ
from probe_vowel_regions import locate

METHOD = 'burg5500-neural-veto-central60ms-v1'
MAX_SECONDS = 6


def decode_recording(body):
    try:
        with sf.SoundFile(io.BytesIO(body)) as f:
            if not 16000 <= f.samplerate <= 96000:
                raise ValueError('Use a recording sampled at 16 kHz or higher.')
            if f.channels not in (1, 2) or not 0 < len(f) <= MAX_SECONDS*f.samplerate:
                raise ValueError('Choose a mono or stereo recording of six seconds or less.')
            rate = f.samplerate
            x = f.read(dtype='float32', always_2d=True).mean(axis=1)
    except (sf.LibsndfileError, RuntimeError):
        raise ValueError('This recording could not be read. Try a WAV file.') from None
    return prepare_audio(x, rate), rate


MESSAGES = {
    'too_short': ('That recording was too short.', 'Say one complete word, then stop.'),
    'near_silence': ('I could not hear a clear sound.', 'Move a little closer to the microphone and try again.'),
    'clipping': ('The recording was too loud.', 'Move a little farther from the microphone.'),
    'weak_periodicity': ('I could not find a clear vowel.', 'Try one word in a quieter room.'),
    'narrowband_tone': ('That sound did not look like a spoken vowel.', 'Say one word in your normal voice.'),
    'room_noise': ('The word did not stand out from the background.', 'Try a quieter place. Stay quiet until “Speak now”.'),
    'early_speech': ('The quiet check included a voiced sound.', 'The opening check could not separate the background from speech. Try the live view, or wait for “Speak now” in a quieter setting.'),
    'no_region': ('I could not isolate a steady vowel.', 'Say one word naturally, with a little quiet before and after.'),
    'multiple_regions': ('I found more than one separate sound.', 'Record just one word for this comparison.'),
    'disagreement': ('The measurements did not agree enough.', 'Try the word once more, at a comfortable volume.'),
    'unstable': ('The vowel measurement moved too much.', 'Try one clear, natural word. You do not need to stretch it.'),
}


def refuse(reason, **extra):
    title, tip = MESSAGES.get(reason, MESSAGES['no_region'])
    return {'status': 'uncertain', 'reason': reason, 'title': title, 'tip': tip,
            'measurement': None, **extra}


def activity_regions(x):
    """Coarse separated sounds only; this is not word recognition."""
    width=320
    energy=np.array([np.mean(x[i:i+width].astype(float)**2)
                     for i in range(0,len(x)-width+1,width)])
    if not len(energy):return []
    mask=energy>max(1e-8,float(energy.max())*.025)
    # Bridge short closures, preserving >=120 ms gaps between sounds.
    starts=np.where(np.diff(np.r_[False,mask,False].astype(int))==1)[0]
    ends=np.where(np.diff(np.r_[False,mask,False].astype(int))==-1)[0]
    regions=[]
    for a,b in zip(starts,ends):
        if regions and a-regions[-1][1]<6:regions[-1][1]=int(b)
        else:regions.append([int(a),int(b)])
    return [(a*.02,b*.02) for a,b in regions if b-a>=4]


class SpeakingEngine:
    def __init__(self):
        torch.set_num_threads(4)
        self.tracker=HeatmapTracker()

    def analyze(self, x, lead_in_ms=0):
        start=time.perf_counter()
        base={'schema_version':1,'method':METHOD,'grade':None,'predicted_word':None,
              'duration_s':round(len(x)/16000,3),'room_check':lead_in_ms==600,
              'limitations':['Experimental acoustic measurements; pronunciation is not graded.',
                  'Filtered or noisy audio can still produce incorrect positions.']}
        def done(result):
            return {**base,**result,'analysis_ms':round((time.perf_counter()-start)*1000)}
        if lead_in_ms not in (0,600):raise ValueError('Unsupported quiet-check duration.')
        if len(x)>MAX_SECONDS*16000 or not np.isfinite(x).all():
            raise ValueError('Use finite audio of six seconds or less.')
        ok,reason=input_gate(x)
        if not ok:return done(refuse(reason))
        region=locate(x)
        if not region['accepted']:return done(refuse('no_region'))
        a,b=region['start_s'],region['end_s']
        # Region edges lie on a 10 ms grid. Compare integer milliseconds:
        # 1.345 - 1.255 can otherwise fall just below the same 90 ms boundary
        # that passes near time zero, making silence padding change eligibility.
        if round((b-a)*1000)<90:return done(refuse('no_region'))
        if lead_in_ms:
            # A UI-guided quiet prefix provides an actual background observation.
            # These are development thresholds, not a calibrated SNR estimator.
            room=x[1600:8000]
            if len(room)<6400:return done(refuse('too_short'))
            if locate(room)['accepted']:return done(refuse('early_speech'))
            if a<.50:return done(refuse('early_speech'))
            voice=x[int(a*16000):int(b*16000)]
            snr=10*np.log10((float(np.mean(voice.astype(float)**2))+1e-12)/
                             (float(np.mean(room.astype(float)**2))+1e-12))
            base['estimated_background_margin_db']=round(float(snr),1)
            if snr<25:return done(refuse('room_noise'))
        if len(activity_regions(x[int(lead_in_ms*16):]))>1:
            return done(refuse('multiple_regions'))
        midpoint=(a+b)/2
        # Retain context for the noncausal model. Never infer from a lone 60 ms
        # snippet or use the intended word to select its measurement.
        crop_start=max(0,int((midpoint-.7)*16000))
        crop_end=min(len(x),int((midpoint+.7)*16000))
        clip=x[crop_start:crop_end]
        nt,nf=self.tracker.predict(clip)
        burg=parselmouth.Sound(clip,16000).to_formant_burg(time_step=.01,
            max_number_of_formants=5,maximum_formant=5500,window_length=.025,
            pre_emphasis_from=50)
        observed=[];accepted=[]
        for absolute_t in midpoint+np.arange(-3,4)*.01:
            t=absolute_t-crop_start/16000
            p=np.array([burg.get_value_at_time(i,t) for i in (1,2)])
            neural=np.array([np.interp(t,nt,nf[:,i]) for i in (0,1)])
            agree=valid(p) and valid(neural) and bool(np.all(np.abs(p-neural)<=AGREEMENT_HZ))
            observed.append({'t':round(float(absolute_t),4),'accepted':agree,
                'burg_hz':p.tolist() if np.isfinite(p).all() else None,
                'neural_hz':neural.tolist()})
            if agree:accepted.append(p)
        detail={'sampled_interval_s':[round(midpoint-.03,4),round(midpoint+.03,4)],
                'accepted_frames':len(accepted),'sampled_frames':7,'observations':observed}
        if len(accepted)<5:return done(refuse('disagreement',**detail))
        values=np.array(accepted)
        q25,q75=np.quantile(values,[.25,.75],axis=0)
        if np.any(q75-q25>[70,130]):return done(refuse('unstable',**detail))
        center=np.median(values,axis=0)
        return done({'status':'measured','reason':None,'title':'A vowel position to compare.',
            'tip':'Replay the word, then try the other vowel. Different positions do not by themselves mean better pronunciation.',
            'measurement':{'f1_hz':round(float(center[0])), 'f2_hz':round(float(center[1])),
                'f1_iqr_hz':[round(float(q25[0])),round(float(q75[0]))],
                'f2_iqr_hz':[round(float(q25[1])),round(float(q75[1]))]},**detail})
