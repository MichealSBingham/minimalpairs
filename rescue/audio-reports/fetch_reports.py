"""Download private recording reports into the existing local QA queue."""
import json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
config='url = "https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/admin/reports"\nheader = "Authorization: Bearer '+(ROOT/'private/admin-token').read_text().strip()+'"\n'
result=subprocess.run(['curl','-sS','--fail','--max-time','30','--config','-'],input=config,text=True,capture_output=True,check=True)
r=json.loads(result.stdout);dest=ROOT.parent/'audio/studio/private/customer-reports.json';tmp=dest.with_suffix('.tmp');tmp.write_text(json.dumps(r));tmp.replace(dest);print(f"Downloaded {len(r['reports'])} recording reports. Refresh the audio review page.")
