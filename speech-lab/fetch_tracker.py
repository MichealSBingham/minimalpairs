"""Fetch the pinned public research model; verify every file before replacement."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
DEST = ROOT / 'models/heatmap-e8a11b6'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'tracker-assets.json').read_text())
    base = 'https://raw.githubusercontent.com/MLSpeech/FormantsTracker/' + manifest['commit'] + '/'
    for name, expected in manifest['files'].items():
        path = DEST / name
        if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
            print('verified', name)
            continue
        if args.verify_only:
            raise SystemExit('Missing or changed asset: ' + name)
        with urlopen(base + name, timeout=90) as response:
            body = response.read()
        if hashlib.sha256(body).hexdigest() != expected:
            raise SystemExit('Downloaded asset failed integrity check: ' + name)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + '.download')
        temporary.write_bytes(body)
        temporary.replace(path)
        print('downloaded and verified', name)


if __name__ == '__main__':
    main()
