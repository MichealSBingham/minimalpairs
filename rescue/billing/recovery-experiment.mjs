export const RECOVERY_PRICE_EXPERIMENT='recovery-price-v1';
export function recoveryExperimentActive(env){return ['RECOVERY_EXPERIMENT_ENABLED','RECOVERY_CONTROL_COPY_APPROVED','RECOVERY_BILLING_ENFORCEMENT_READY','DIAGNOSTIC_EXPERIMENT_ENROLLMENT_CLOSED'].every(k=>env[k]==='true');}
export function prepareRecoveryCandidate(offer,env,random=()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296){
 if(!recoveryExperimentActive(env))return offer;
 const draw=random();if(!Number.isFinite(draw)||draw<0||draw>=1)throw Error('Invalid experiment draw');
 return {...offer,experiment:RECOVERY_PRICE_EXPERIMENT,arm:draw<.5?'standard':'discount',assignedAt:offer.createdAt};
}
export function discountAvailable(offer){return !!offer&&!(offer.experiment===RECOVERY_PRICE_EXPERIMENT&&offer.arm==='standard');}
