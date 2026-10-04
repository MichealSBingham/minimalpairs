"""Fetch private customer support locally. Never sends replies."""
import json, os, subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
config='url = "https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/admin/support"\nheader = "Authorization: Bearer '+(root/'private/admin-token').read_text().strip()+'"\n'
result=subprocess.run(['curl','-sS','--fail','--max-time','30','--config','-'],input=config,text=True,capture_output=True,check=True)
data=json.loads(result.stdout);dest=root/'private/support-inbox.json'
fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:json.dump(data,f,ensure_ascii=False,indent=2)
print(f"Saved {len(data['tickets'])} support requests to the private local inbox.")
