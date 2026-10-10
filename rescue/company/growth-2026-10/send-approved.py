#!/usr/bin/env python3
"""Send one exact owner-approved outreach payload; keep private durable receipts."""
import argparse, datetime, hashlib, json, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RECEIPTS = ROOT.parent / 'private' / 'growth-outreach-receipts.json'
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(rows):
    temp = RECEIPTS.with_suffix('.tmp')
    temp.write_text(json.dumps(rows, indent=2) + '\n')
    temp.chmod(0o600)
    temp.replace(RECEIPTS)

p = argparse.ArgumentParser()
p.add_argument('id', choices=['P01','P02','P05','P08','P10'])
p.add_argument('--send', action='store_true')
a = p.parse_args()
approval = json.loads((ROOT/'message-approval.json').read_text())
m = next(x for x in approval['outreach'] if x['id']==a.id)
payload_path = ROOT/'email-previews'/(a.id+'.payload.json')
raw = payload_path.read_bytes()
assert m['approved'] and hashlib.sha256(raw).hexdigest()==m['payloadSha256'], 'Approval mismatch'
payload = json.loads(raw)
assert len(payload['to'])==1 and 'micheal@minimalpairs.co' in payload['from']
rows = json.loads(RECEIPTS.read_text()) if RECEIPTS.exists() else {}
if a.id in rows:
    raise SystemExit(a.id+': already recorded as '+rows[a.id]['status']+'; reconcile instead of resending')
if not a.send:
    print(a.id+': exact approved payload verified; no email sent')
    raise SystemExit()
preflight = json.loads((ROOT/'send-preflight.json').read_text())
assert preflight['eligibleIds'] and a.id in preflight['eligibleIds']
assert (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(preflight['checkedAt'])).total_seconds()<3600, 'Refresh send exclusions'
token = (ROOT.parents[1]/'audio-reports/private/resend-key').read_text().strip()
assert token and not any(c in token for c in '\r\n"\\')
idem = 'minimalpairs-growth-20261009-'+a.id+'-'+m['payloadSha256'][:20]
rows[a.id]={'status':'sending','attemptedAt':now(),'to':payload['to'],'subject':payload['subject'],'payloadSha256':m['payloadSha256'],'idempotencyKey':idem}
save(rows)
config = 'url = "https://api.resend.com/emails"\nheader = "Authorization: Bearer '+token+'"\nheader = "Content-Type: application/json"\nheader = "Idempotency-Key: '+idem+'"\n'
result = subprocess.run(['curl','--silent','--show-error','--max-time','30','--request','POST','--config','-','--data-binary','@'+str(payload_path),'--write-out','\n%{http_code}'],input=config,text=True,capture_output=True)
try:
    body,status = result.stdout.rsplit('\n',1)
    data=json.loads(body)
    accepted=result.returncode==0 and 200<=int(status)<300 and isinstance(data.get('id'),str)
    rows[a.id].update(status='accepted' if accepted else 'uncertain' if result.returncode or int(status)>=500 else 'failed',httpStatus=status,providerId=data.get('id'),updatedAt=now())
except Exception:
    rows[a.id].update(status='uncertain',updatedAt=now())
save(rows)
print(a.id+': '+rows[a.id]['status']+' '+str(rows[a.id].get('providerId') or ''))
if rows[a.id]['status']!='accepted': raise SystemExit(1)
