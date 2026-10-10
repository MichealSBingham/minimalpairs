#!/usr/bin/env python3
"""Refresh the private first-party funnel and verified-purchase report."""
import json, subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
token=(root/'private/admin-token').read_text().strip()
if not token or any(c in token for c in '\r\n"\\'):raise SystemExit('Invalid credential')
config='url = "https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/admin/analytics"\nheader = "Authorization: Bearer '+token+'"\n'
r=subprocess.run(['curl','--silent','--show-error','--fail','--max-time','30','--config','-'],input=config,text=True,capture_output=True)
if r.returncode:raise SystemExit('First-party report unavailable; do not report zero traffic')
d=json.loads(r.stdout)
target=root.parent/'company/private/product-metrics-latest.json'
target.write_text(json.dumps(d,indent=2)+'\n');target.chmod(0o600)
print(json.dumps(d,indent=2))
