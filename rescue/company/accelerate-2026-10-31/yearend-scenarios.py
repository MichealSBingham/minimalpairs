"""Conditional scenarios, not validated probabilities of execution success."""
import random, math, json
from pathlib import Path
rng=random.Random(311026)
values=[29]*5+[13.05,7,7]
def poisson(lam):
    limit=math.exp(-lam); product=1.; k=0
    while product>limit: k+=1; product*=rng.random()
    return k-1
output={'cutoff':'2026-10-31','futureWindow':'2026-11-01 through 2026-12-31','grossUSDAlreadyCollectedExcluded':172.05,'observedPurchases':8,'exposureDaysAssumed':25,'averageInitialPurchaseUSD':sum(values)/len(values),'method':'Gamma-Poisson sales rate with Jeffreys prior, empirical resampling of eight initial purchase values','caveats':['Growth multipliers are assumptions, not fitted or demonstrated effects.','Intervals are conditional on each multiplier and unchanged empirical price mix.','Gross new initial purchases only; excludes fees, refunds, commissions, costs and future renewals.','Eight purchases and 25 inclusive calendar days provide a thin baseline; October 31 is incomplete.','No new IPA or speaking-feature revenue is assumed.'],'scenarios':{}}
for name,multipliers in [('unchanged',[1,1]),('execution_target',[1.5,2.5]),('stretch',[3,5])]:
    totals=[]; monthly=[[],[]]
    for _ in range(50000):
        rate=rng.gammavariate(8.5,1/25)
        cash=[sum(rng.choice(values) for _ in range(poisson(rate*days*mult))) for days,mult in zip([30,31],multipliers)]
        totals.append(sum(cash))
        for i,v in enumerate(cash):monthly[i].append(v)
    totals.sort()
    output['scenarios'][name]={'novemberRateMultiplier':multipliers[0],'decemberRateMultiplier':multipliers[1],'meanNewGrossUSD':round(sum(totals)/len(totals),2),'medianNewGrossUSD':round(totals[len(totals)//2],2),'conditionalP10':round(totals[len(totals)//10],2),'conditionalP90':round(totals[len(totals)*9//10],2),'novemberMeanGrossUSD':round(sum(monthly[0])/len(totals),2),'decemberMeanGrossUSD':round(sum(monthly[1])/len(totals),2)}
Path(__file__).with_suffix('.json').write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(output,indent=2))
