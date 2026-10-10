#!/usr/bin/env python3
"""Render a private owner report from the latest first-party metrics snapshot."""
import json,html
from pathlib import Path
root=Path(__file__).resolve().parent
d=json.loads((root/'private/product-metrics-latest.json').read_text())
escape=lambda x:html.escape(str(x))
def table(headers,rows):
 return '<div class="scroll"><table><thead><tr>'+''.join('<th>'+escape(x)+'</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+escape(x)+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table></div>'
days=sorted(d['days'].items(),reverse=True)
rows=[]
for day,v in days:
 f=v['funnel'];rows.append([day.split(':')[1],f['visitors'] if v['events'] else 'Not measured',v['events'].get('page_view',0) if v['events'] else 'Not measured',f['practiceStarted'],f['answered'],f['completed'],f['checkout'],v['purchases'],', '.join(f'{k.upper()} {n/100:.2f}' for k,n in v['grossMinor'].items())])
content='<h1>MinimalPairs business analytics</h1><p>Refreshed '+escape(d['checkedAt'])+' · UTC dates</p><p>First-party reporting is independent of Google Analytics. Daily visitors are estimates; browser data begins with the October 10 release. Historical sales do not imply historical visit coverage.</p><h2>Visits, practice and verified sales</h2>'+table(['Date','Visitors est.','Pageviews','Started','Answered','Completed','Checkout','Purchases','Gross'],rows)
content+='<h2>Verified purchases</h2>'+table(['Payment confirmed UTC','Amount','Observed source','Language','Landing page','Joined daily visit'],[[p.get('paymentConfirmedAt') or 'Unavailable',f"{p['currency'].upper()} {p['amount']/100:.2f}",p['source'],p['language'],p['landingPage'],'Yes' if p['joined'] else 'No'] for p in d['latestVerifiedPurchases']])
content+='<h2>Partial and completed practice</h2>'+table(['UTC day · language · sound group','Attempts','Answered rounds','Completed','Exited','Inactive incomplete'],[[k,v['attempts'],v['answeredRounds'],v['completed'],v['exited'],v['inactiveIncomplete']] for k,v in d.get('attemptSummary',{}).items()])
source_rows=[]
for day,v in days:
 for source,n in v['sources'].items():source_rows.append([day.split(':')[1],source,n,v['purchaseSources'].get(source,0)])
content+='<h2>Discovery</h2>'+table(['UTC date','Source','Daily visitors est.','Verified purchases'],source_rows)
status=root/'private/buyer-automation-status.json'
if status.exists():
 b=json.loads(status.read_text()).get('buyers',{});content+='<h2>Founder follow-up</h2>'+table(['Collector','Purchase reports pending','Email states'],[[b.get('collector',{}).get('state','unknown'),b.get('reportingPending','unknown'),json.dumps(b.get('states',{}))]])
content+='<p>Source is an observed referral, not a reason for buying. Missing context stays unknown. Inactive incomplete means no observed completion after 30 minutes. Counts from Google Analytics and this report must not be added together. This is a snapshot; refresh the collector before making decisions.</p>'
doc='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MinimalPairs business analytics</title><style>body{font:16px/1.6 system-ui;margin:32px auto;padding:0 24px;max-width:1200px;color:#24231e;background:#faf8f2}h1,h2{font-family:Georgia,serif}h2{margin-top:40px}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;vertical-align:top}th{font-weight:600}.scroll{overflow-x:auto}p{color:#575750;max-width:900px}</style><main>'+content+'</main></html>'
(root/'private/product-analytics.html').write_text(doc)
print(root/'private/product-analytics.html')
