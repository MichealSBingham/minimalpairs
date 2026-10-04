"""Verify every planned local English recording, not merely the process exit."""
import argparse,json
import studio

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--bank',default='en-US-ga',choices=list(studio.LOCALES));selected=parser.parse_args()
    db=studio.connect()
    args=argparse.Namespace(provider='chatterbox',bank=selected.bank,all_words=True,limit=None)
    voices=[{'id':label,'name':'Chatterbox '+label,'locale':studio.LOCALES[selected.bank],'referenceSha256':value[1],'accentVerified':False} for label,value in studio.bank_refs(selected.bank).items()]
    jobs=studio.plan(db,args,voices)
    completed=0;flags=[];missing=[];size=0
    for job in jobs:
        row=db.execute('SELECT * FROM clips WHERE id=?',(job['id'],)).fetchone()
        if not row or row['status']!='complete':missing.append(job['id']);continue
        path=studio.Path(row['path'])
        if not path.exists() or studio.sha(path.read_bytes())!=row['sha']:missing.append(job['id']);continue
        completed+=1;size+=path.stat().st_size
        audit=json.loads(row['details']).get('technicalAudit',{})
        if audit.get('flags'):flags.append({'id':job['id'],'word':job['text'],'voice':job['voice']['name'],'flags':audit['flags']})
    result={'expected':len(jobs),'verifiedCompleted':completed,'missingOrChanged':missing,'signalFlags':flags,'audioBytes':size,'pronunciationStatus':'unreviewed'}
    (studio.STATE/('english-completion.json' if selected.bank=='en-US-ga' else selected.bank+'-completion.json')).write_text(json.dumps(result,indent=2)+'\n')
    if missing:raise SystemExit(f'INCOMPLETE: {completed}/{len(jobs)} verified recordings. See private/english-completion.json.')
    print(f'DONE — {completed}/{len(jobs)} recordings verified; {len(flags)} signal flags for review. Pronunciation remains unreviewed.')
if __name__=='__main__':main()
