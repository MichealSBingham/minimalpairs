"""Read notification status or enqueue saved support/reports. Never prints secrets/content."""
import argparse,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('action',choices=['status','enqueue-existing']);args=p.parse_args()
root=Path(__file__).resolve().parent
key=(root/'private/admin-token').read_text().strip()
if any(c in key for c in '\r\n"\\'):raise SystemExit('Invalid admin credential format')
config='url = "https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/admin/notifications"\nheader = "Authorization: Bearer '+key+'"\n'
if args.action=='enqueue-existing':config+='request = "POST"\n'
r=subprocess.run(['curl','--silent','--show-error','--fail','--max-time','30','--config','-'],input=config,text=True,capture_output=True)
if r.returncode:raise SystemExit('Notification administration failed; no private response printed.')
data=json.loads(r.stdout);print(json.dumps({k:data.get(k) for k in ['enabled','pending','sent','held']}))
