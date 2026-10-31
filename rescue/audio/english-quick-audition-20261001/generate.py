import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import time

HERE = Path(__file__).resolve().parent
ADAPTER = HERE.parent / 'voice-audition-v2/local_candidate.py'
spec = importlib.util.spec_from_file_location('audition_helpers', ADAPTER)
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
helpers.PRESETS = ('Ryan', 'Aiden')
helpers.SETTINGS = {**helpers.SETTINGS, 'language': 'English'}
model_path = helpers.validate_model(HERE.parent / 'voice-audition-v2/models/qwen-customvoice-1.7b-4bit')
words = json.loads((HERE / 'words.json').read_text())
assert len(words) == 16 and len({w['wordId'] for w in words}) == 16
assert all(w['languageId'] == 'en' and w['bankId'] == 'en-US-ga' for w in words)
assert not (HERE / 'manifest.json').exists(), 'Never overwrite a previous run'
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
(HERE / 'clips').mkdir(exist_ok=True)
report = {'id': HERE.name, 'status': 'loading-model', 'model': helpers.REPO,
          'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'targetAccent': 'General American; listening review required',
          'language': 'English', 'voices': list(helpers.PRESETS), 'clips': []}
for word in words:
    for speaker in helpers.PRESETS:
        identity = {'word': word, 'speaker': speaker, 'model': helpers.REPO,
                    'revision': helpers.REVISION, 'settings': helpers.SETTINGS}
        clip_id = helpers.digest(identity)[:24]
        report['clips'].append({**word, 'id': clip_id, 'speaker': speaker,
            'voiceId': 'qwen-cv-en-' + speaker.lower(), 'provider': 'qwen-local-mlx',
            'model': helpers.REPO, 'modelRevision': helpers.REVISION,
            'language': 'English', 'locale': 'en-US', 'accentVerified': False,
            'seed': int(helpers.digest({'wordId': word['wordId'], 'speaker': speaker})[:8],16),
            'url': 'clips/' + clip_id + '.wav', 'technicalStatus': 'pending',
            'reviewStatus': 'pending', 'generationSettings': helpers.SETTINGS, 'sha256': None})
helpers.save_json(HERE / 'manifest.json', report)
try:
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.utils import load_model
    started = time.monotonic()
    model = load_model(str(model_path))
    report['status'] = 'generating'
    for index, clip in enumerate(report['clips']):
        try:
            helpers.render_clip(model, clip, HERE / clip['url'], mx, np, sf)
        except Exception as error:
            clip.update(technicalStatus='failed', technicalFlags=[str(error)[:250]])
        report['completed'] = index + 1
        helpers.save_json(HERE / 'manifest.json', report)
        print(json.dumps({'completed': index + 1, 'total': len(report['clips']), 'word': clip['text'], 'voice': clip['speaker'], 'status': clip['technicalStatus']}), flush=True)
    report.update(status='complete', elapsedSeconds=round(time.monotonic()-started,2))
except Exception as error:
    report.update(status='failed', error=str(error)[:300])
finally:
    helpers.save_json(HERE / 'manifest.json', report)
