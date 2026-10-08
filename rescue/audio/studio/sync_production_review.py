#!/usr/bin/env python3
"""Snapshot deployed audio manifests for owner review; never infer production from source."""
import argparse, collections, datetime, hashlib, json, urllib.request
from pathlib import Path
HERE=Path(__file__).resolve().parent
PRIVATE=HERE/'private'
BANKS=('us','fr','es','de','it','pt','ru','zh','ja')
def sync(origin='https://minimalpairs.co'):
    clips=[]; sources=[]
    for bank in BANKS:
        url=f'{origin}/audio/chatterbox-{bank}/manifest.json'
        with urllib.request.urlopen(urllib.request.Request(url,headers={'Cache-Control':'no-cache'}),timeout=45) as response:
            payload=response.read()
        manifest=json.loads(payload)
        if not isinstance(manifest.get('clips'),list):raise ValueError(f'Invalid manifest {url}')
        sources.append({'url':url,'sha256':hashlib.sha256(payload).hexdigest()})
        for clip in manifest['clips']:
            if not clip.get('id') or len(clip.get('sha256',''))!=64:raise ValueError(f'Invalid clip in {url}')
            clips.append(clip)
    data={'origin':origin,'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sources':sources,'clips':clips,'byBank':dict(collections.Counter(c['bankId'] for c in clips))}
    PRIVATE.mkdir(exist_ok=True)
    target=PRIVATE/'production-review.json';temp=target.with_suffix('.tmp');temp.write_text(json.dumps(data,ensure_ascii=False));temp.replace(target)
    print(json.dumps({'fetchedAt':data['fetchedAt'],'clips':len(clips),'byBank':data['byBank']}))
    return data
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--origin',default='https://minimalpairs.co');args=parser.parse_args();sync(args.origin)
