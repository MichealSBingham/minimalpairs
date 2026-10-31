"""Bayesian piecewise-exponential purchase-time model.
Not fitted to MinimalPairs users: current aggregate exports lack risk intervals.
X contains only covariates known at interval start; exposure is measured in days.
A row with event=0 is right-censored exposure, NOT a permanent nonbuyer.
Group coefficient priors share learned half-normal scales (source/language etc.).
"""
import numpy as np


def log_posterior(theta, X, exposure, event, group_index):
    X=np.asarray(X,float); t=np.asarray(exposure,float); y=np.asarray(event,float)
    groups=np.asarray(group_index,int)
    if X.ndim!=2 or len(t)!=len(X) or len(y)!=len(X):raise ValueError('shape')
    p=X.shape[1];g=int(groups.max())+1 if len(groups) else 0
    if len(groups)!=p-1 or len(theta)!=p+g:raise ValueError('coefficient groups')
    if np.any(t<=0) or not np.isin(y,[0,1]).all():raise ValueError('invalid risk interval')
    b=np.asarray(theta[:p]); logtau=np.asarray(theta[p:]); eta=X@b
    if not np.isfinite(eta).all() or np.max(eta)>700 or np.max(np.abs(logtau),initial=0)>100:return -np.inf
    # Exact event-time likelihood for constant hazard within each risk interval.
    value=float(np.sum(y*eta-t*np.exp(eta)))
    # Explicit weak baseline assumption, varied in prior sensitivity checks.
    value-=.5*((b[0]-np.log(.005))/2)**2
    for j in range(1,p):
        l=logtau[groups[j-1]]
        value+=-.5*b[j]**2*np.exp(-2*l)-l
    # tau ~ HalfNormal(0.5), transformed to log(tau), including Jacobian.
    value+=float(np.sum(logtau-.5*np.exp(2*logtau)/.5**2))
    return value


def purchase_curve(beta_draws, future_X, interval_days):
    """Conditional on supplied future behavior path; NOT omniscient prediction.
    To predict unknown future paths, marginalize this result over path scenarios.
    """
    b=np.asarray(beta_draws,float);x=np.asarray(future_X,float);dt=np.asarray(interval_days,float)
    if x.ndim!=2 or b.ndim!=2 or x.shape[1]!=b.shape[1] or len(x)!=len(dt) or np.any(dt<=0):raise ValueError('shape/exposure')
    cumulative=np.cumsum(np.exp(x@b.T)*dt[:,None],axis=0)
    return -np.expm1(-cumulative)


def sample_posterior(X, exposure, event, group_index, draws=4000, warmup=4000, chains=4, seed=271026):
    """Reference Metropolis sampler. Offline only; no auto promotion of results.
    Thirty events is a conservative execution guard, not a sufficiency guarantee.
    Validate convergence/ESS, calibration and chronological holdout before use.
    """
    X=np.asarray(X,float);event=np.asarray(event,int);groups=np.asarray(group_index,int)
    if event.sum()<30:raise ValueError('insufficient purchase events for individual model; use aggregate baseline')
    p=X.shape[1];g=int(groups.max())+1 if len(groups) else 0;rng=np.random.default_rng(seed)
    saved=[];accept=[]
    for c in range(chains):
        theta=np.r_[np.log(.005)+rng.normal(0,.2),np.zeros(p-1),np.full(g,np.log(.3))]
        lp=log_posterior(theta,X,exposure,event,groups);out=[];accepted=0;window=0;scale=.05
        for i in range(warmup+draws):
            candidate=theta+rng.normal(0,scale,len(theta));new=log_posterior(candidate,X,exposure,event,groups)
            if np.log(rng.uniform())<new-lp:theta=candidate;lp=new;accepted+=1;window+=1
            if i<warmup and (i+1)%100==0:
                scale*=np.exp(np.clip(window/100-.25,-.1,.1));window=0
            if i>=warmup:out.append(theta.copy())
        saved.append(out);accept.append(accepted/(warmup+draws))
    samples=np.asarray(saved);within=samples.var(axis=1,ddof=1).mean(axis=0);between=draws*samples.mean(axis=1).var(axis=0,ddof=1)
    rhat=np.sqrt(((draws-1)/draws*within+between/draws)/within)
    return {'samples':samples,'rhat_basic':rhat,'acceptance':accept,'productionReady':False,'note':'basic Rhat is not sufficient; inspect ESS, trace, prior sensitivity and future-data calibration'}
