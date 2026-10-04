"""Replace six signal-flagged local clips; preserve originals and attempt evidence."""
import argparse,fcntl,json,time,shutil
import studio as s

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clip-id", help="Regenerate one exact Chatterbox clip instead of all signal-flagged clips")
    parser.add_argument('--bank',default='en-US-ga',choices=list(s.LOCALES))
    args=parser.parse_args()
    db=s.connect()
    with (s.STATE/'.run.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        rows=[dict(r) for r in db.execute("SELECT * FROM clips WHERE provider='chatterbox' AND status='complete'") if json.loads(r['details'])['bank']==args.bank and (r['id']==args.clip_id if args.clip_id else json.loads(r['details']).get('technicalAudit',{}).get('flags'))]
        if not rows:
            if args.clip_id: raise ValueError('No completed Chatterbox recording matches that clip ID')
            print('No signal-flagged clips remain.');return
        folder=s.STATE/'repairs'/time.strftime('%Y%m%d-%H%M%S');folder.mkdir(parents=True)
        model=s.Chatterbox(args.bank); results=[]
        for row in rows:
            old=json.loads(row['details']);path=s.Path(row['path'])
            if s.sha(path.read_bytes())!=row['sha']:raise ValueError('Original checksum changed')
            shutil.copy2(path,folder/(row['id']+'-original.wav'))
            (folder/(row['id']+'-original.json')).write_text(s.dumps(row))
            result={'word':old['text'],'voice':old['voice']['name'],'attempts':[],'replaced':False}
            for attempt in range(1,4):
                job=dict(old);job['seed']=(old['seed']+104729*attempt)%2**32
                candidate=folder/(row['id']+f'-attempt-{attempt}.wav')
                model.generate(job,candidate);audit=s.audit(candidate)
                result['attempts'].append({'seed':job['seed'],'audit':audit,'path':str(candidate)})
                if not audit['flags']:
                    job['technicalAudit']=audit;job['repair']={'originalSha256':row['sha'],'originalSeed':old['seed'],'archive':str(folder),'reason':'owner-confirmed artifacts among duration-flagged clips','pronunciationStatus':'unreviewed'}
                    job['renderIdentity']=s.identity({k:v for k,v in job.items() if k not in ['id','technicalAudit','repair']})
                    temporary=path.with_suffix('.repair.wav');shutil.copy2(candidate,temporary);temporary.replace(path)
                    db.execute("UPDATE clips SET details=?,sha=?,review='unreviewed' WHERE id=?",(s.dumps(job),s.sha(path.read_bytes()),row['id']));db.commit();result['replaced']=True;break
            results.append(result)
            (folder/'report.json').write_text(s.dumps(results))
            print(s.dumps(result),flush=True)
        s.report(db)
if __name__=='__main__':main()
