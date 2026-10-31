"""Local-only browser fixtures from already credited audio; never product assets."""
from pathlib import Path
import numpy as np
import soundfile as sf
from speaking_server import REFS
from speaking_engine import decode_recording

root=Path('/tmp/minimalpairs-speaking-qa')
root.mkdir(exist_ok=True)
ref=next(r for r in REFS.values() if r['speaker']=='Grendelkhan' and r['word']=='ship')
x,_=decode_recording(ref['path'].read_bytes())
sf.write(root/'capture.wav',np.r_[np.zeros(16000),x,np.zeros(80000)].astype('float32'),16000)
sf.write(root/'ship.wav',x,16000)
sf.write(root/'silence.wav',np.zeros(16000),16000)
print('Prepared local browser fixtures.')
