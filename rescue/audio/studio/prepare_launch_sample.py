#!/usr/bin/env python3
"""Choose a reproducible three-word sample per deployed voice; never changes audio."""
import collections, hashlib, json, sqlite3
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
report = json.loads((HERE/'private/quality-report.json').read_text())
local = {(c['id'], c['sha']): c for c in report['clips']}
layer = {(c['id'], c['sha']): c for c in json.loads((HERE/'private/layer2-report.json').read_text())['clips']}
customer = {(c['clipId'], c['sha256']) for c in json.loads((HERE/'private/customer-reports.json').read_text()).get('reports', [])}
db = sqlite3.connect(HERE/'private/quality.sqlite3')
decisions = {(r[0],r[1]):r[2] for r in db.execute('SELECT clip_id,sha,decision FROM decisions ORDER BY sequence')}
db.close()
groups = collections.defaultdict(list)
for path in sorted((ROOT/'app/public/audio').glob('chatterbox-*/manifest.json')):
    for clip in json.loads(path.read_text())['clips']:
        key = (clip['id'], clip['sha256'])
        if key in local and key in layer and not local[key]['flags'] and not layer[key]['flags'] and key not in customer and decisions.get(key, 'unreviewed') == 'unreviewed':
            groups[(clip['bankId'], clip['voiceId'])].append(clip)
selected = []
for key, clips in sorted(groups.items()):
    covered = set()
    words = set()
    for _ in range(3):
        candidates = [c for c in clips if c['wordId'] not in words]
        if not candidates: break
        def rank(c):
            categories = {(m['contrastId'], m['category']) for m in c['memberships']}
            return (-len(categories-covered), hashlib.sha256(c['id'].encode()).hexdigest())
        c = min(candidates, key=rank)
        covered.update((m['contrastId'],m['category']) for m in c['memberships'])
        words.add(c['wordId'])
        selected.append({'id':c['id'],'sha':c['sha256'],'bank':key[0],'voice':key[1]})
(HERE/'private/launch-sample.json').write_text(json.dumps(selected,indent=2)+'\n')
print(json.dumps({'clips':len(selected),'byBank':dict(collections.Counter(c['bank'] for c in selected))}))
