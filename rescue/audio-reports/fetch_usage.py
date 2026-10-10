#!/usr/bin/env python3
"""Read anonymous daily totals without exposing the private credential in argv."""
import json
import subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
token=(root/'private/admin-token').read_text().strip()
if not token or any(c in token for c in '\r\n"\\'):
    raise SystemExit('Invalid private credential format')
config='url = "https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/admin/usage"\nheader = "Authorization: Bearer '+token+'"\n'
result=subprocess.run(['curl','--silent','--show-error','--fail','--max-time','30','--config','-'],input=config,text=True,capture_output=True)
if result.returncode:
    raise SystemExit('Usage report request failed; check connection and stored authorization.')
print(json.dumps(json.loads(result.stdout),indent=2))
