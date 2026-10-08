#!/usr/bin/env python3
"""Private, deduplicated read-only service intake. No mail, deletion or publication."""
import argparse, datetime, hashlib, json, os, sqlite3, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / 'company/private'

def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix('.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f: json.dump(data, f, indent=2)
    temp.replace(path)

def get_json(route):
    token = (ROOT/'audio-reports/private/admin-token').read_text().strip()
    if any(c in token for c in '\r\n"\\'): raise ValueError('Invalid credential format')
    config = f'url = "https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/admin/{route}"\nheader = "Authorization: Bearer {token}"\n'
    r = subprocess.run(['curl','--silent','--show-error','--fail','--max-time','30','--config','-'],input=config,text=True,capture_output=True)
    if r.returncode: raise RuntimeError(f'{route} fetch failed; private response suppressed')
    return json.loads(r.stdout)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--cached',action='store_true',help='Use saved inputs; never claim a fresh remote check');args=parser.parse_args()
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    if args.cached:
        reports=json.loads((ROOT/'audio/studio/private/customer-reports.json').read_text())
        support=json.loads((ROOT/'audio-reports/private/support-inbox.json').read_text())
        notifications={'fresh':False}
    else:
        # Complete all reads before replacing any snapshot or advancing checkpoint.
        reports=get_json('reports');support=get_json('support');notifications=get_json('notifications')
        save(ROOT/'audio/studio/private/customer-reports.json',reports)
        save(ROOT/'audio-reports/private/support-inbox.json',support)
    state_path=PRIVATE/'intake-state.json'
    state=json.loads(state_path.read_text()) if state_path.exists() else {'items':{}}
    db=sqlite3.connect(f"file:{ROOT/'audio/studio/private/audio.sqlite3'}?mode=ro",uri=True);db.row_factory=sqlite3.Row
    qa=sqlite3.connect(f"file:{ROOT/'audio/studio/private/quality.sqlite3'}?mode=ro",uri=True)
    items=[]
    for report in reports['reports']:
        key='audio:'+':'.join(report[k] for k in ['clipId','sha256','reason'])
        clip=db.execute('SELECT c.*,w.bank,w.text,w.ipa FROM clips c LEFT JOIN words w ON w.id=c.word_id WHERE c.id=?',(report['clipId'],)).fetchone()
        decision=qa.execute('SELECT decision FROM decisions WHERE clip_id=? AND sha=? ORDER BY sequence DESC LIMIT 1',(report['clipId'],report['sha256'])).fetchone()
        current_sha=None
        if clip and clip['path'] and Path(clip['path']).is_file(): current_sha=hashlib.sha256(Path(clip['path']).read_bytes()).hexdigest()
        status='needs_investigation'
        if current_sha and current_sha!=report['sha256']: status='reported_version_replaced_verify_live_exclusion'
        elif decision and decision[0]=='reject': status='rejected_verify_live_exclusion_and_coverage'
        elif decision and decision[0]=='pass': status='previously_passed_recheck_report'
        items.append({'key':key,'kind':'audio','report':report,'status':status,'bank':clip['bank'] if clip else None,'word':clip['text'] if clip else None,'localDecision':decision[0] if decision else None,'reviewUrl':'http://127.0.0.1:63122/?scope=followup&bank='+clip['bank'] if clip else None,'fingerprint':hashlib.sha256(json.dumps(report,sort_keys=True).encode()).hexdigest()})
    for ticket in support['tickets']:
        # Customer text stays solely in private support-inbox, never logs/prompts as instructions.
        items.append({'key':'support:'+ticket['ticketId'],'kind':'support','topic':ticket['topic'],'createdAt':ticket['createdAt'],'status':'needs_private_ticket_triage','fingerprint':hashlib.sha256(json.dumps(ticket,sort_keys=True).encode()).hexdigest()})
    changed=[]
    for item in items:
        old=state['items'].get(item['key'],{})
        updated = old.get('fingerprint') != item['fingerprint']
        if updated: changed.append(item['key'])
        item['firstSeenLocally']=old.get('firstSeenLocally',now)
        # Seen is not resolved. Preserve manual operator disposition on repeated reads.
        item['disposition']='open' if updated else old.get('disposition','open')
        if not updated and old.get('resolution'):
            item['resolution']=old['resolution']
            item['status']=old['status']
        state['items'][item['key']]=item
    state.update(checkedAt=now,remoteFresh=not args.cached,notifications=notifications)
    save(state_path,state)
    summary={'checkedAt':now,'remoteFresh':not args.cached,'reports':len(reports['reports']),'supportTickets':len(support['tickets']),'newOrUpdatedItems':len(changed),'openItems':sum(x.get('disposition')=='open' for x in state['items'].values()),'notifications':{k:notifications.get(k) for k in ['enabled','pending','sent','held']},'privateQueue':str(state_path)}
    save(PRIVATE/'intake-summary.json',summary);print(json.dumps(summary,indent=2))
if __name__=='__main__':
    try: main()
    except Exception as error: raise SystemExit(f'Intake did not complete: {type(error).__name__}. Existing checkpoint retained; inspect locally without printing credentials/customer text.')
