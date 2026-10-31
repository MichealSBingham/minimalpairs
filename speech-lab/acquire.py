"""Fetch pinned public assets. No credentials, paid APIs, or remote model code."""
from pathlib import Path
import hashlib, json, urllib.request
from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parent
MODEL_REV = '2c733782da5604684829819a5eb744c193fe9398'

def fetch(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with urllib.request.urlopen(url, timeout=90) as response:
            data = response.read()
        path.write_bytes(data)
    return path.read_bytes()

def main():
    directory = ROOT / 'models' / 'phoneme'
    snapshot_download('facebook/wav2vec2-xlsr-53-espeak-cv-ft', revision=MODEL_REV,
                      local_dir=directory, allow_patterns=['*.json', '*.bin', 'README.md'])
    print('Phoneme model downloaded', flush=True)
    api = 'https://api.github.com/repos/jimbozhang/speechocean762/commits/main'
    commit = json.loads(fetch(api, ROOT / 'data' / 'source-commit.json'))['sha']
    base = f'https://raw.githubusercontent.com/jimbozhang/speechocean762/{commit}/'
    for name in ['README.md', 'resource/scores.json', 'resource/lexicon.txt',
                 'test/wav.scp', 'test/utt2spk', 'test/spk2age', 'test/spk2gender', 'test/text']:
        fetch(base + name, ROOT / 'data' / name)
    print('Dataset metadata downloaded at', commit, flush=True)
    print((ROOT / 'data/test/wav.scp').read_text().splitlines()[:2])
    scores = json.loads((ROOT / 'data/resource/scores.json').read_text())
    print('First score record:', next(iter(scores.items())))
    (ROOT/'artifacts/provenance.json').write_text(json.dumps({
        'model': 'facebook/wav2vec2-xlsr-53-espeak-cv-ft', 'model_revision': MODEL_REV,
        'model_license': 'Apache-2.0', 'dataset': 'jimbozhang/speechocean762',
        'dataset_revision': commit,
        'dataset_source': 'https://github.com/jimbozhang/speechocean762',
        'dataset_license': 'CC-BY-4.0; official project explicitly permits commercial use',
        'paid_spend_usd': 0,
    }, indent=2))

if __name__ == '__main__': main()
