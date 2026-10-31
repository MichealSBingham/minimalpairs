"""Rebuild weekly facts and fixed targets; no projected values are actuals."""
import json,datetime,collections,html
from pathlib import Path
root=Path(__file__).resolve().parent
private=root.parent/'private'
p=json.loads((private/'product-metrics-latest.json').read_text())
weeks={}
for key,d in sorted(p['days'].items()):
 date=datetime.date.fromisoformat(key.split(':')[-1]); start=date-datetime.timedelta(days=date.weekday())
 w=weeks.setdefault(str(start),{'start':str(start),'end':str(start+datetime.timedelta(days=6)),'daysPresent':0,'visitorDays':0,'activePracticeBrowserDays':0,'sessionStarts':0,'sessionCompletions':0,'answers':0,'diagnosticStarts':0,'diagnosticCompletions':0,'purchases':0,'grossUSD':0})
 w['daysPresent']+=1
 w['visitorDays']+=d.get('funnel',{}).get('visitors',0);w['activePracticeBrowserDays']+=d.get('funnel',{}).get('answered',0)
 for target,event in [('sessionStarts','practice_start'),('sessionCompletions','practice_complete'),('answers','practice_answer'),('diagnosticStarts','diagnostic_start'),('diagnosticCompletions','diagnostic_complete')]:w[target]+=d.get('events',{}).get(event,0)
 w['purchases']+=d.get('purchases',0);w['grossUSD']+=d.get('grossMinor',{}).get('usd',0)/100
for w in weeks.values():
 w['complete']=w['daysPresent']==7 and w['end']<p['checkedAt'][:10]
 w['diagnosticCompletionPct']=round(100*w['diagnosticCompletions']/w['diagnosticStarts'],1) if w['diagnosticStarts'] else None
 w['revenuePer100VisitorDays']=round(100*w['grossUSD']/w['visitorDays'],2) if w['visitorDays'] and w['complete'] else None
# Fixed operational targets, never silently reforecast to match actuals.
targets=[{'week':'Nov 2–8','purchasesTarget':2,'grossIfAll29':58},{'week':'Nov 9–15','purchasesTarget':3,'grossIfAll29':87},{'week':'Nov 16–22','purchasesTarget':4,'grossIfAll29':116},{'week':'Nov 23–29','purchasesTarget':5,'grossIfAll29':145}]
report={'asOf':p['checkedAt'],'timezone':'UTC','weeks':list(weeks.values()),'targets':targets,'limitations':['Visitor-days sum daily estimates; they are not weekly unique people.','Session event counts can include repeat sessions. Distinct active browser-days are reported separately.','October 5–11 has incomplete usage coverage and historical payments; exclude it from conversion comparisons.','Current week is partial. Tracking and product changes prevent causal before/after claims.','Gross payments are not profit or recurring revenue.','Targets assume $29 lifetime purchases; monthly or discounted purchases reduce realized revenue.'],'changes':[{'date':'2026-10-28','change':'Personalized diagnostic next-practice offer experiment began; result-stage 50/50 assignment.'},{'date':'2026-10-28','change':'Ten partner messages sent; acquisition paths published.'},{'date':'2026-10-28','change':'Paid-access safeguard deployed; Scott restored.'},{'date':'2026-10-28','change':'Post-demo friend referral action published.'}],'decisions':['Review full weeks each Monday and include current partial week separately.','If completions rise without checkout starts, inspect offer exposure and buyer intent before adding traffic features.','If checkout starts rise without paid purchases, inspect checkout errors and payment flow.','Report zero exposure experiments as unmeasured, never winners.','Review partner replies Nov 4; no unapproved follow-up sends.']}
(private/'weekly-scorecard.json').write_text(json.dumps(report,indent=2)+'\n')
columns=[('start','Week beginning'),('visitorDays','Visitor-days*'),('activePracticeBrowserDays','Active browser-days*'),('sessionCompletions','Completed sessions'),('answers','Answers'),('diagnosticCompletions','Completed diagnostics'),('purchases','Purchases'),('grossUSD','Gross $')]
rows=''.join('<tr>'+''.join('<td>'+html.escape(str(w[k]))+('</td>' if k!='start' else (' <small>partial</small></td>' if not w['complete'] else '</td>')) for k,_ in columns)+'</tr>' for w in weeks.values())
charts=''
for metric,label,color in [('sessionCompletions','Completed practice sessions','#36796e'),('grossUSD','Gross revenue ($)','#b45335')]:
 maximum=max(w[metric] for w in weeks.values()) or 1
 bars=''.join(f'<div class="barrow"><span>{w["start"]}{" *" if not w["complete"] else ""}</span><div class="track"><div style="width:{100*w[metric]/maximum}%;background:{color}"></div></div><b>{w[metric]:g}</b></div>' for w in weeks.values())
 charts+=f'<section><h2>{label}</h2>{bars}</section>'
page='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MinimalPairs weekly scorecard</title><style>body{font:16px/1.55 system-ui;background:#f7f5ef;color:#242723;max-width:1100px;margin:auto;padding:32px}h1{font-size:36px}small{color:#985027}section{background:white;padding:22px;border-radius:12px;margin:18px 0}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd;white-space:nowrap}.barrow{display:flex;gap:12px;align-items:center;margin:12px 0}.barrow span{width:110px;font-size:14px}.track{flex:1;background:#eee;height:22px}.track div{height:100%}.barrow b{width:50px}.note{color:#62675e}li{margin:9px 0}</style>'''
page+='<h1>Are we growing the business?</h1><p>Practice depth improved. Revenue growth is not established.</p><p class="note">Updated '+html.escape(p['checkedAt'])+' · UTC weeks · internal report</p>'+charts
page+='<section class="scroll"><h2>Recorded activity</h2><table><thead><tr>'+''.join('<th>'+label+'</th>' for _,label in columns)+'</tr></thead><tbody>'+rows+'</tbody></table><p>* Visitor-days and active browser-days can count the same person on different days. Partial weeks are not comparable to full weeks.</p></section>'
page+='<section><h2>Fixed four-week execution targets, not forecasts</h2><table><tr><th>Week</th><th>Purchases</th><th>Gross if all $29</th></tr>'+''.join(f'<tr><td>{t["week"]}</td><td>{t["purchasesTarget"]}</td><td>${t["grossIfAll29"]}</td></tr>' for t in targets)+'</table><p>Total target: 14 purchases / $406 if all lifetime at $29. The last two full weeks had one purchase each; reaching these targets requires a real increase, not continuation of the current trend.</p></section>'
page+='<section><h2>Change log</h2><ul>'+''.join('<li>'+html.escape(c['date']+' — '+c['change'])+'</li>' for c in report['changes'])+'</ul><h2>Decision rules</h2><ul>'+''.join('<li>'+html.escape(x)+'</li>' for x in report['decisions'])+'</ul><h2>Reading the numbers</h2><ul>'+''.join('<li>'+html.escape(x)+'</li>' for x in report['limitations'])+'</ul></section>'
(private/'weekly-scorecard.html').write_text(page)
print(json.dumps(report,indent=2))
