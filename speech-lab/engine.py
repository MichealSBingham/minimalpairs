"""Experimental acoustic evidence, never a calibrated pronunciation grade."""
from pathlib import Path
import io, json, math, time
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
import parselmouth

ROOT = Path(__file__).resolve().parent
PAIRS = {
    'tout-tu': {'language':'French', 'words':['tout','tu'], 'phones':[['t','u'],['t','y']], 'vowels':['u','y'], 'tip':'Both vowels have rounded lips. For /y/, start with /i/ and round your lips while keeping the tongue forward.'},
    'vous-vu': {'language':'French', 'words':['vous','vu'], 'phones':[['v','u'],['v','y']], 'vowels':['u','y'], 'tip':'Keep the /v/ the same. Explore the contrast between back /u/ and front /y/, with rounded lips for both.'},
    'roue-rue': {'language':'French', 'words':['roue','rue'], 'phones':[['ʁ','u'],['ʁ','y']], 'vowels':['u','y'], 'tip':'Focus on the vowel. This experiment does not grade the many acceptable French rhotic realizations.'},
    'sheep-ship': {'language':'English', 'words':['sheep','ship'], 'phones':[['ʃ','iː','p'],['ʃ','ɪ','p']], 'vowels':['i','ɪ'], 'tip':'Listen for vowel quality as well as duration. /ɪ/ is typically more open and central than /iː/.'},
    'feel-fill': {'language':'English', 'words':['feel','fill'], 'phones':[['f','iː','l'],['f','ɪ','l']], 'vowels':['i','ɪ'], 'tip':'Keep the consonants steady. The final /l/ can change the vowel acoustics, so do not chase a fixed dot.'},
    'seat-sit': {'language':'English', 'words':['seat','sit'], 'phones':[['s','iː','t'],['s','ɪ','t']], 'vowels':['i','ɪ'], 'tip':'Try the contrast in a new word. Duration alone is not enough to distinguish these vowels.'},
}

def decode_audio(source):
    audio, sr = sf.read(io.BytesIO(source) if isinstance(source, bytes) else source, dtype='float32', always_2d=True)
    if not 8000 <= sr <= 96000: raise ValueError('Use audio sampled between 8 and 96 kHz.')
    if len(audio) > sr * 15: raise ValueError('Use a recording of 15 seconds or less.')
    audio = audio.mean(axis=1)
    if sr != 16000:
        divisor = math.gcd(sr, 16000)
        audio = resample_poly(audio, 16000//divisor, sr//divisor).astype('float32')
    return audio

def quality(audio):
    if len(audio) < 2400: return 'Record at least 0.15 seconds.'
    if len(audio) > 240000: return 'Record no more than 15 seconds.'
    if not np.isfinite(audio).all(): return 'Audio contains invalid samples.'
    if np.sqrt(np.mean(audio**2)) < .003: return 'Too quiet to analyze. Try again closer to the microphone.'
    if np.mean(np.abs(audio) >= .985) > .01: return 'Audio is clipping. Move back and try again.'
    # A conservative periodicity gate rejects obvious non-speech controls, not all OOD sounds.
    strengths=[]
    for start in range(0, len(audio)-800, 400):
        x=audio[start:start+800].astype(float); x-=x.mean()
        if np.sqrt(np.mean(x*x)) < .003: continue
        ac=np.correlate(x,x,'full')[799:]
        strengths.append(float(np.max(ac[32:229])/(ac[0]+1e-12)))
    if not strengths or max(strengths)<.3: return 'No clear voiced speech found. Try a short, clear word.'
    return None

def normalize_phone(phone):
    # Duration is not judged by the short-word classifier; preserve all other distinctions.
    return phone.replace('ː','').replace('ˑ','')

def formants(audio):
    """Two fixed Praat ceilings; disagreement hides uncertain frames, no target snapping."""
    if len(audio)<1200: return []
    snd=parselmouth.Sound(audio,16000)
    trackers=[snd.to_formant_burg(time_step=.02, max_number_of_formants=5,
        maximum_formant=c, window_length=.025, pre_emphasis_from=50) for c in [5000,5500]]
    pitch=snd.to_pitch(time_step=.02, pitch_floor=70, pitch_ceiling=500)
    rows=[]
    for t in np.arange(.04,len(audio)/16000-.04,.02):
        if not np.isfinite(pitch.get_value_at_time(t)): continue
        estimates=np.array([[f.get_value_at_time(i,t) for i in [1,2]] for f in trackers])
        if not np.isfinite(estimates).all(): continue
        if np.any(np.abs(estimates[0]-estimates[1])>[120,220]): continue
        f1,f2=estimates.mean(axis=0)
        if 150<f1<1200 and f1+150<f2<3500:
            rows.append({'t':round(float(t),3),'f1':round(float(f1)), 'f2':round(float(f2))})
    return rows

def acoustic_analysis(audio):
    """Prompt-independent vowel acoustics. No ASR, target word or IPA label is used."""
    start=time.perf_counter();failure=quality(audio)
    base={'schema_version':'0.1.0','method':'praat-burg-two-ceiling-consensus-v1',
          'grade':None,'predicted_ipa':None,'accent_classification':None,
          'duration_s':round(len(audio)/16000,3),'calibrated':False}
    if failure:return {**base,'status':'retry','message':failure,'formants':[], 'latency_s':round(time.perf_counter()-start,3)}
    frames=formants(audio)
    # Choose the longest locally continuous run, without consulting intended vowel.
    runs=[];run=[]
    for frame in frames:
        if run and (frame['t']-run[-1]['t']>.041 or abs(frame['f1']-run[-1]['f1'])>100 or abs(frame['f2']-run[-1]['f2'])>180):
            runs.append(run);run=[]
        run.append(frame)
    if run:runs.append(run)
    stable=max(runs,key=len,default=[])
    supported=len(stable)>=6
    summary=None
    if supported:
        values=np.array([[p['f1'],p['f2']] for p in stable]); med=np.median(values,axis=0)
        q25,q75=np.quantile(values,[.25,.75],axis=0)
        summary={'f1_hz':round(float(med[0])),'f2_hz':round(float(med[1])),
            'f1_iqr_hz':[round(float(q25[0])),round(float(q75[0]))],
            'f2_iqr_hz':[round(float(q25[1])),round(float(q75[1]))],
            'start_s':stable[0]['t'],'end_s':stable[-1]['t'],
            'observed_span_s':round(stable[-1]['t']-stable[0]['t'],3),
            'frames':len(stable)}
    return {**base,'status':'measured' if supported else 'uncertain',
        'message':'A steady acoustic region was measured. Compare repeated attempts using the same microphone.' if supported else 'No sufficiently steady region was found. Hold one comfortable vowel for about two seconds.',
        'formants':frames,'steady_frames':stable if supported else [],'summary':summary,
        'accepted_frames':len(frames),'possible_frames':len(np.arange(.04,len(audio)/16000-.04,.02)),
        'interpretation':'F1/F2 measure resonances. They do not uniquely identify tongue position, vowel identity or pronunciation correctness. The steady region is automatic, not a verified phoneme boundary.',
        'latency_s':round(time.perf_counter()-start,3)}

class Engine:
    def __init__(self):
        import torch
        from transformers import Wav2Vec2ForCTC
        self.torch=torch
        torch.set_num_threads(4)
        path=ROOT/'models/phoneme'
        self.model=Wav2Vec2ForCTC.from_pretrained(path,local_files_only=True).eval()
        self.vocab=json.loads((path/'vocab.json').read_text())
        self.inverse={v:k for k,v in self.vocab.items()}
        self.blank=self.model.config.pad_token_id

    def recognize(self,audio):
        torch=self.torch
        x=(audio-audio.mean())/np.sqrt(audio.var()+1e-7)
        with torch.inference_mode():
            logits=self.model(torch.from_numpy(x.copy()).unsqueeze(0),
                attention_mask=torch.ones((1,len(x)),dtype=torch.long)).logits[0]
            logp=logits.log_softmax(-1)
        ids=logp.argmax(-1).tolist(); phones=[]; events=[]; previous=None
        for i,token in enumerate(ids):
            if token!=previous and token!=self.blank:
                phone=self.inverse[token]
                if not phone.startswith('<'):
                    phones.append(phone)
                    events.append({'phone':phone,'t':round((i*320+200)/16000,3),
                        'posterior':round(float(logp[i,token].exp()),4)})
            previous=token
        return {'phones':phones,'events':events,'logp':logp}

    def candidate_cost(self,logp,phones):
        torch=self.torch
        tokens=torch.tensor([self.vocab[p] for p in phones],dtype=torch.long)
        loss=torch.nn.functional.ctc_loss(logp[:,None,:],tokens,
            torch.tensor([len(logp)]),torch.tensor([len(tokens)]),
            blank=self.blank,reduction='sum',zero_infinity=False)
        return float(loss)/max(1,len(logp))

    def analyze(self,audio,pair_id='tout-tu',target=0,include_formants=True):
        if pair_id not in PAIRS or target not in [0,1]: raise ValueError('Unknown exercise or target.')
        start=time.perf_counter(); pair=PAIRS[pair_id]
        failure=quality(audio)
        base={'pair':pair_id,'target':pair['words'][target], 'target_ipa':' '.join(pair['phones'][target]),
              'grade':None,'calibrated':False,'accent_classification':None,
              'tip':pair['tip'],'duration_s':round(len(audio)/16000,3)}
        if failure: return {**base,'status':'retry','message':failure,'phones':[],'formants':[],'latency_s':round(time.perf_counter()-start,3)}
        r=self.recognize(audio)
        costs=[self.candidate_cost(r['logp'],p) for p in pair['phones']]
        winner=int(np.argmin(costs)); margin=abs(costs[0]-costs[1])
        normalized=[normalize_phone(p) for p in r['phones']]
        vowels=[v for v in pair['vowels'] if v in normalized]
        # Frozen v1 gate: cross-check unconstrained decoding with constrained pair ranking.
        # Context is required so unrelated speech is not assigned to one of two words.
        expected=[normalize_phone(p) for p in pair['phones'][winner]]
        context_match=(normalized==expected)
        supported=(len(vowels)==1 and vowels[0]==pair['vowels'][winner] and context_match and margin>=.03)
        status=('target-evidence' if winner==target else 'contrast-evidence') if supported else 'uncertain'
        message={
            'target-evidence':f'The model heard the target pattern in {pair["words"][target]}. This is encouraging evidence, not a correctness grade.',
            'contrast-evidence':f'The model favored {pair["words"][winner]}, the other word in this pair. Replay and compare the vowel.',
            'uncertain':'The model cannot confidently resolve this pair. Replay, then try one clear word.'}[status]
        return {**base,'status':status,'message':message,'phones':r['phones'],'events':r['events'],
                'candidate_costs':dict(zip(pair['words'],[round(c,4) for c in costs])),
                'margin':round(margin,4),'candidate_winner':pair['words'][winner],
                'formants':formants(audio) if include_formants else [],
                'latency_s':round(time.perf_counter()-start,3)}
