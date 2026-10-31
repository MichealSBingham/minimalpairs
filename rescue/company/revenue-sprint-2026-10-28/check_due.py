"""Read-only daily task/experiment deadline check; no messages or mutations."""
import json
from pathlib import Path
from datetime import datetime,timezone,date
p=Path(__file__).with_name("checkpoint.json")
d=json.loads(p.read_text()); today=datetime.now(timezone.utc).date()
for t in d["tasks"]:
 if t["status"] not in ("complete","cancelled"):
  state="DUE" if date.fromisoformat(t["due"])<=today else "UPCOMING"
  print(f"{state}: {t['id']} | {t['due']} | {t['status']} | {t['description']}")
for name,e in d["experiments"].items():
 print(f"EXPERIMENT: {name} | {e['status']} | end={e.get('enrollmentEnds')}")
 if e.get("enrollmentEnds") and date.fromisoformat(e["enrollmentEnds"][:10])<=today and e["status"]=="running":
  print(f"ACTION REQUIRED: close {name} enrollment and preserve follow-up outcomes")
print("NEXT REVIEWS:",", ".join(x for x in d["reviews"] if x>=today.isoformat()))
print("OUTREACH: exact owner approval required; pending",len(d["outreach"]["queue"]))

# Keep all active operating plans visible in the existing morning report.
for relative,key in [("../accelerate-2026-10-31/checkpoint.json","reviews"),("../regional-pricing-2026-10-30/checkpoint.json","reviewDates")]:
 plan_path=p.parent/relative
 plan=json.loads(plan_path.read_text())
 for review in plan.get(key,[]):
  item=review if isinstance(review,dict) else {"date":review,"action":"Review regional exposure, revenue and payment reliability"}
  if item.get("status") in ("complete","cancelled"):continue
  state="DUE" if date.fromisoformat(item["date"])<=today else "UPCOMING"
  print(f"{state}: {plan_path.parent.name} | {item['date']} | {item['action']}")
