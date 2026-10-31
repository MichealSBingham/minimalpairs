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
diagnostic_rows=[]
for day,v in days:
 for length,counts in v.get('diagnostics',{}).items():
  diagnostic_rows.append([day.split(':')[1],length,counts.get('diagnostic_start',0),counts.get('diagnostic_complete',0),counts.get('diagnostic_offer_click',0),counts.get('begin_checkout',0),counts.get('purchases',0)])
content+='<h2>Short versus full diagnostics</h2><p>New events only. Checkout and purchase use the last observed diagnostic length; this is a comparison of self-selected users, not a randomized experiment.</p>'+table(['UTC date','Version','Started','Completed','Offer clicks','Checkout','Purchases'],diagnostic_rows)
offer_rows=[]
for day,v in days:
 for key,e in v.get('offers',{}).items():
  u=e.get('visitorEstimates',{})
  offer_rows.append([day.split(':')[1],key,u.get('plans_view',0),u.get('plan_selected',0),u.get('begin_checkout',0),e.get('purchases',0),e.get('grossMinor',{}).get('usd',0)/100])
content+='<h2>Purchase offer placement</h2><p>Explicit placement labels only. Daily visitor estimates are not exact people; an earlier checkout without placement remains unattributed.</p>'+table(['UTC date','Placement','Saw plans','Selected plan','Checkout','Purchases','Gross USD'],offer_rows)
experiment_rows=[]
for day,v in days:
 for key,e in v.get('experiments',{}).items():
  u=e.get('visitorEstimates',{})
  experiment_rows.append([day.split(':')[1],key,u.get('experiment_exposure',0),e.get('attempts',0),u.get('diagnostic_complete',0),u.get('plan_selected',0),u.get('login',0),u.get('begin_checkout',0),u.get('checkout_error',0),e.get('purchases',0),e.get('grossMinor',{}).get('usd',0)/100])
content+='<h2>Diagnostic report experiment</h2><p>Assigned exposures are daily browser estimates, not exact people or distinct visitors across days. Starts count distinct observed attempt IDs. Completion, selection and checkout columns count daily estimates with the explicit variant; purchases use the immutable checkout metadata, not later browsing. Do not sum daily estimates as unique people or infer significance from small samples.</p>'+table(['UTC date','Experiment | variant','Exposed estimates','Attempts started','Completed estimates','Plan-selection estimates','Sign-in estimates','Checkout estimates','Checkout errors','Paid purchases','Gross USD'],experiment_rows)
experiment_totals={}
for _,v in days:
 for key,e in v.get('experiments',{}).items():
  t=experiment_totals.setdefault(key,{'exposures':0,'purchases':0,'gross':0})
  t['exposures']+=e.get('visitorEstimates',{}).get('experiment_exposure',0)
  t['purchases']+=e.get('purchases',0)
  t['gross']+=e.get('grossMinor',{}).get('usd',0)/100
content+='<h3>Observed-window revenue comparison</h3><p>Exposure denominator is the sum of daily exposed-browser estimates, not distinct people. Later purchases and repeat-day visits can change this ratio. Gross only; reconcile refunds separately. No significance or winner is implied.</p>'+table(['Variant','Daily exposed estimates summed','Purchases','Gross USD','Gross per exposure estimate USD'],[[k,t['exposures'],t['purchases'],round(t['gross'],2),round(t['gross']/t['exposures'],3) if t['exposures'] else 'Not measurable'] for k,t in experiment_totals.items()])
conversion_events=['diagnostic_complete','diagnostic_offer_click','diagnostic_report_unlock_click','plan_selected','login','begin_checkout','checkout_error']
content+='<h2>Where purchase interest stops</h2><p>Offer clicks scroll to the plans. Report unlock clicks select a plan inside diagnostic results. Plan selections, sign-ins and checkout starts below are site-wide event totals, not a joined diagnostic cohort or unique people; do not divide these columns into a conversion rate.</p>'+table(['UTC date','Diagnostics completed','Scrolled to plans','Diagnostic plan clicks','All plan selections','All sign-ins','Checkout starts','Checkout errors'],[[day.split(':')[1],*[v['events'].get(event,0) for event in conversion_events]] for day,v in days])
content+='<h2>Verified purchases</h2>'+table(['Payment confirmed UTC','Amount','Observed source','Language','Landing page','Joined daily visit'],[[p.get('paymentConfirmedAt') or 'Unavailable',f"{p['currency'].upper()} {p['amount']/100:.2f}",p['source'],p['language'],p['landingPage'],'Yes' if p['joined'] else 'No'] for p in d['latestVerifiedPurchases']])
content+='<h2>Partial and completed practice</h2>'+table(['UTC day · language · sound group','Attempts','Answered rounds','Completed','Exited','Inactive incomplete'],[[k,v['attempts'],v['answeredRounds'],v['completed'],v['exited'],v['inactiveIncomplete']] for k,v in d.get('attemptSummary',{}).items()])
source_rows=[]
for day,v in days:
 for source,n in v['sources'].items():source_rows.append([day.split(':')[1],source,n,v['purchaseSources'].get(source,0)])
language_rows=[]
for day,v in days:
 totals={}
 for key,n in v.get('languages',{}).items():
  event,language,*_=key.split('|')
  if event not in ['practice_start','practice_answer','practice_complete','practice_audio_error']:continue
  row=totals.setdefault(language,{})
  row[event]=row.get(event,0)+n
 for language,row in sorted(totals.items()):language_rows.append([day.split(':')[1],language,row.get('practice_start',0),row.get('practice_answer',0),row.get('practice_complete',0),row.get('practice_audio_error',0)])
content+='<h2>Practice by language and playback errors</h2><p>Event counts, not distinct learners. Playback errors do not establish a pronunciation defect.</p>'+table(['UTC date','Language','Starts','Answers','Completions','Playback errors'],language_rows)
content+='<h2>Discovery</h2>'+table(['UTC date','Source','Daily visitors est.','Verified purchases'],source_rows)
status=root/'private/buyer-automation-status.json'
if status.exists():
 b=json.loads(status.read_text()).get('buyers',{});content+='<h2>Founder follow-up</h2>'+table(['Collector','Purchase reports pending','Email states'],[[b.get('collector',{}).get('state','unknown'),b.get('reportingPending','unknown'),json.dumps(b.get('states',{}))]])
content+='<p>Source is an observed referral, not a reason for buying. Missing context stays unknown. Inactive incomplete means no observed completion after 30 minutes. Counts from Google Analytics and this report must not be added together. This is a snapshot; refresh the collector before making decisions.</p>'
doc='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MinimalPairs business analytics</title><style>body{font:16px/1.6 system-ui;margin:32px auto;padding:0 24px;max-width:1200px;color:#24231e;background:#faf8f2}h1,h2{font-family:Georgia,serif}h2{margin-top:40px}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;vertical-align:top}th{font-weight:600}.scroll{overflow-x:auto}p{color:#575750;max-width:900px}</style><main>'+content+'</main></html>'
(root/'private/product-analytics.html').write_text(doc)
print(root/'private/product-analytics.html')
