"""Read-only sprint refresh. Credentials never appear in output; failures are not zeros."""
import json,subprocess,datetime,os
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
PRIVATE=HERE.parent/'private'
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sources':{},'experiments':{},'actions':[]}
def run(name,args,env=None):
 p=subprocess.run(args,cwd=ROOT,env=env,text=True,capture_output=True,timeout=90)
 if p.returncode:
  report['sources'][name]={'status':'unavailable'};report['actions'].append('Refresh '+name+' before interpreting missing data');return None
 try:d=json.loads(p.stdout)
 except ValueError:report['sources'][name]={'status':'invalid-response'};return None
 report['sources'][name]={'status':'refreshed','at':d.get('checkedAt') or d.get('generatedAt') or d.get('asOf')};return d
metrics=run('firstParty',['python3','rescue/audio-reports/fetch_product_metrics.py'])
stripe=run('stripe',['node','rescue/billing/operator/business-metrics.mjs','--days=30'])
buyer_learning=run('buyerLearning',['node','rescue/billing/operator/buyer-learning.mjs'])
if buyer_learning:report['buyerLearning']=buyer_learning
secret=json.loads((ROOT/'rescue/email-course-service/private/service-secrets.json').read_text())
env={**os.environ,'EMAIL_SERVICE_ORIGIN':'https://minimalpairs-email-course.sirmichealbingham.workers.dev','EMAIL_ADMIN_TOKEN':secret['ADMIN_TOKEN']}
course=run('course',['node','rescue/company/revenue-sprint-2026-10-28/fetch-course-status.mjs'],env)
if course:
 report['course']=course
 report['actions'].extend(course.get('actions',[]))
recovery=run('recovery',['node','rescue/company/revenue-sprint-2026-10-28/fetch-recovery-status.mjs'],env)
if recovery:report['recovery']=recovery
if stripe:
 report['stripeWindow']=stripe.get('window');report['stripeCurrentOffer']=stripe.get('currentOffer')
if metrics:
 # Check the entire purchase funnel, not only users assigned to an experiment.
 baseline_path=PRIVATE/'checkout-error-baseline.json'
 baseline=json.loads(baseline_path.read_text()) if baseline_path.exists() else {}
 today=datetime.datetime.now(datetime.timezone.utc).date()
 health=[]
 for date,day in metrics.get('days',{}).items():
  day_string=date.removeprefix('productDay:')
  if day_string < (today-datetime.timedelta(days=1)).isoformat():continue
  errors=day.get('events',{}).get('checkout_error',0)
  new_errors=max(0,errors-baseline.get(day_string,{}).get('acknowledgedErrors',0))
  health.append({'date':day_string,'checkoutErrors':errors,'newErrorsSinceAcknowledgedIncident':new_errors,'checkoutHandoffs':day.get('funnel',{}).get('checkout',0)})
  if new_errors:report['actions'].insert(0,f'URGENT: {new_errors} unacknowledged checkout errors on {day_string}; investigate before growth work, even outside experiment cohorts')
 report['checkoutHealth']=health
 report['entrancePages']={date:day.get('entrancePages',{}) for date,day in metrics.get('days',{}).items() if day.get('entrancePages')}
 report['regionalPricing']={date:day.get('markets',{}) for date,day in metrics.get('days',{}).items() if day.get('markets')}
 for date,day in metrics.get('days',{}).items():
  for key,arm in day.get('experiments',{}).items():
   if not key.startswith('diag-next-step-v1|'):continue
   t=report['experiments'].setdefault(key,{'dailyExposedEstimates':0,'observedAttempts':0,'purchases':0,'grossUSDCents':0,'events':{}})
   t['dailyExposedEstimates']+=arm.get('visitorEstimates',{}).get('experiment_exposure',0)
   t['observedAttempts']+=arm.get('attempts',0);t['purchases']+=arm.get('purchases',0);t['grossUSDCents']+=arm.get('grossMinor',{}).get('usd',0)
   for k,v in arm.get('events',{}).items():t['events'][k]=t['events'].get(k,0)+v
 for t in report['experiments'].values():
  t['grossUSDPerDailyExposureEstimate']=t['grossUSDCents']/100/t['dailyExposedEstimates'] if t['dailyExposedEstimates'] else None
  if t['events'].get('checkout_error',0):report['actions'].append('Investigate experiment checkout errors; pause treatment if confirmed regression')
report['limits']=['Daily exposure estimates are not unique experiment-period people. Browser randomization is persistent only in that browser. No statistical winner declared by this script.','Stripe 30-day totals and first-party historical totals have differing windows; do not subtract blindly. Recovery report explicitly identifies unavailable refunds/fees.','Diagnostic result-stage assignment cannot measure upstream diagnostic completion effects.']
learning_path=PRIVATE/'conversion-learning-notes.json'
if learning_path.exists():report['conversionLearning']=json.loads(learning_path.read_text())
report['deadlines']=subprocess.run(['python3',str(HERE/'check_due.py')],text=True,capture_output=True).stdout.splitlines()
target=PRIVATE/'revenue-sprint-status.json';target.write_text(json.dumps(report,indent=2)+'\n');target.chmod(0o600)
if metrics:subprocess.run(['python3','rescue/company/render-product-report.py'],cwd=ROOT,capture_output=True)
if metrics:subprocess.run(['python3',str(HERE/'weekly_scorecard.py')],cwd=ROOT,capture_output=True,check=True)
print(json.dumps(report,indent=2))
