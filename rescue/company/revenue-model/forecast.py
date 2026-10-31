"""Reproducible small-data Bayesian cash-sales baseline; not individual propensity.
Run: python3 rescue/company/revenue-model/forecast.py
Only NumPy required. Inputs are frozen verified aggregate evidence, not user records.
"""
import json
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent
rng=np.random.default_rng(271026)
DRAWS=200000

def summary(x):
 return {'mean':round(float(np.mean(x)),2),'median':round(float(np.median(x)),2),'p10':round(float(np.quantile(x,.1)),2),'p90':round(float(np.quantile(x,.9)),2),'p025':round(float(np.quantile(x,.025)),2),'p975':round(float(np.quantile(x,.975)),2)}

def forecast(count,days,multiplier=1):
 # Poisson sales intensity with Jeffreys prior proportional to lambda^-1/2.
 intensity=rng.gamma(count+.5,1/days,DRAWS)*multiplier
 # Initial purchase mix only; future monthly renewals deliberately excluded.
 lifetime_share=rng.beta(5+.5,1+.5,DRAWS)
 out={}
 for horizon in [30,60,90]:
  buyers=rng.poisson(intensity*horizon)
  lifetime=rng.binomial(buyers,lifetime_share)
  gross=29*lifetime+7*(buyers-lifetime)
  out[str(horizon)]={'buyers':summary(buyers),'additionalGrossUSD':summary(gross),'pGrossAtLeast':{str(t):round(float(np.mean(gross>=t)),5) for t in [150,300,500,1000]},'pAtLeastOnePurchase':round(float(np.mean(buyers>=1)),5)}
 # Time until the next business-wide sale, not an individual customer's purchase time.
 wait=rng.exponential(1/intensity)
 out['daysUntilNextSale']=summary(wait)
 return out

result={'model':'Gamma-Poisson marked sales process; Jeffreys priors','evidenceCutoff':'2026-10-28T02:12:47Z','seed':271026,'draws':DRAWS,'units':'USD gross initial-sale revenue, before fees/costs/refunds; cumulative within horizon','fit':'aggregate sales only; no individual model fitted','baseline24days':forecast(6,24),'recent14daysSensitivity':forecast(3,14),'recent7daysSensitivity':forecast(1,7),'assumedTwofoldRateScenario':forecast(6,24,2),'assumedFourfoldRateScenario':forecast(6,24,4),'limits':['24-day calendar exposure approximates partial days','Stationary Poisson rate is an assumption, not established; recent site and attribution changes violate strict stationarity','No causal uplift fitted; 2x/4x are hypothetical scenario inputs','Six buyers do not validate probability calibration','No refunds/fees/renewals/discount mix forecast; new discounts reduce gross','No reliable visitor-to-person cohort denominator or user purchase-time model from present aggregate data']}
(ROOT/'forecast-results.json').write_text(json.dumps(result,indent=2)+'\n')
for key in ['baseline24days','recent14daysSensitivity','recent7daysSensitivity','assumedTwofoldRateScenario','assumedFourfoldRateScenario']:
 print(key,json.dumps(result[key]['30']))
