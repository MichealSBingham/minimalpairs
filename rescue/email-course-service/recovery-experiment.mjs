/** Future recovery experiment. Not wired into sending or billing until activation gates pass. */
export const RECOVERY_EXPERIMENT_ID = 'recovery-price-v1';
const WINDOW_MS = 14 * 86400000;
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n=>n.toString(16).padStart(2,'0')).join('');
export function experimentEnabled(env) {
 return env.RECOVERY_EXPERIMENT_ENABLED === 'true' && env.RECOVERY_CONTROL_COPY_APPROVED === 'true'
  && env.RECOVERY_BILLING_ENFORCEMENT_READY === 'true' && env.DIAGNOSTIC_EXPERIMENT_ENROLLMENT_CLOSED === 'true';
}
/** Eligibility must be rechecked against billing before assignment AND before sending. */
export async function assignRecoveryExperiment(storage, env, {uid, eligible, suppressed=false, now=Date.now(), random=()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296}) {
 if (!experimentEnabled(env)) return null;
 if (!eligible || suppressed || typeof uid !== 'string' || !uid) return null;
 const key='recoveryExperiment:'+await hash(uid);
 return storage.transaction(async tx=>{
  const existing=await tx.get(key); if(existing)return existing;
  const draw=random(); if(!Number.isFinite(draw)||draw<0||draw>=1)throw Error('Invalid random draw');
  const row={experiment:RECOVERY_EXPERIMENT_ID,accountHash:key.split(':')[1],arm:draw<.5?'standard':'discount',assignedAt:now,windowEndsAt:now+WINDOW_MS,expectedAmount:draw<.5?2900:1450,currency:'usd',exposures:[]};
  await tx.put(key,row);return row;
 });
}
export async function recordRecoveryExposure(storage, accountHash, {providerId, now=Date.now()}) {
 if(typeof providerId!=='string'||!providerId)throw Error('Provider acceptance ID required');
 const key='recoveryExperiment:'+accountHash;
 return storage.transaction(async tx=>{const row=await tx.get(key);if(!row)throw Error('Assignment missing');
 if(!row.exposures.some(e=>e.providerId===providerId)){row.exposures.push({providerId,acceptedAt:now});await tx.put(key,row);}return row;});
}
/** Completed Stripe purchases only; caller performs account join. All prices count in ITT. */
export function summarizeRecoveryExperiment(assignments, purchases, now=Date.now()) {
 const result={experiment:RECOVERY_EXPERIMENT_ID,windowDays:14,arms:{}};
 for(const arm of ['standard','discount']){
  const rows=assignments.filter(r=>r.experiment===RECOVERY_EXPERIMENT_ID&&r.arm===arm&&r.windowEndsAt<=now);
  const members=new Map(rows.map(r=>[r.accountHash,r]));const unique=new Map();
  for(const p of purchases){const r=members.get(p.accountHash);if(!r||p.verified!==true||p.currency!=='usd'||!p.purchaseId||!Number.isSafeInteger(p.amountPaid)||p.amountPaid<0||!Number.isSafeInteger(p.refundedAmount??0)||(p.refundedAmount??0)<0||(p.refundedAmount??0)>p.amountPaid||p.paidAt<r.assignedAt||p.paidAt>=r.windowEndsAt)continue; unique.set(p.purchaseId,p);}
  const paid=[...unique.values()],gross=paid.reduce((s,p)=>s+p.amountPaid,0),refunds=paid.reduce((s,p)=>s+(p.refundedAmount??0),0);
  result.arms[arm]={matureAssigned:rows.length,pendingAssigned:assignments.filter(r=>r.experiment===RECOVERY_EXPERIMENT_ID&&r.arm===arm&&r.windowEndsAt>now).length,providerAccepted:rows.filter(r=>r.exposures?.length).length,buyers:new Set(paid.map(p=>p.accountHash)).size,purchases:paid.length,grossCents:gross,refundCents:refunds,receiptsAfterRefundsCents:gross-refunds,receiptsPerAssignedCents:rows.length?(gross-refunds)/rows.length:null};
 }
 return result;
}

async function allRows(storage,prefix){
 const rows=[];let startAfter;
 while(true){const page=await storage.list({prefix,limit:1000,...(startAfter?{startAfter}:{})});rows.push(...page.values());if(page.size<1000)break;startAfter=[...page.keys()].at(-1);}
 return rows;
}
/** Private admin aggregate only. No emails, account hashes, IDs, tokens or raw rows escape. */
export async function recoveryExperimentStatus(storage,env,{now=Date.now()}={}){
 const recovery=await allRows(storage,'recovery:'),purchaseRows=await allRows(storage,'buyerPurchase:');
 const byAccount=new Map();
 for(const row of recovery){if(row.experiment!==RECOVERY_EXPERIMENT_ID||!['standard','discount'].includes(row.arm)||!row.uid)continue;
  // First eligible collector time is enrollment. Assignment was precommitted at checkout.
  const accountHash=await hash(row.uid),candidate={experiment:row.experiment,accountHash,arm:row.arm,assignedAt:row.createdAt,windowEndsAt:row.createdAt+WINDOW_MS,exposures:row.acceptedAt?[{acceptedAt:row.acceptedAt}]:[]};
  const previous=byAccount.get(accountHash);if(!previous||candidate.assignedAt<previous.assignedAt)byAccount.set(accountHash,candidate);
 }
 const purchases=[];let missingJoin=0,missingVerifiedTime=0;
 for(const row of purchaseRows){if(!row.accountHash){missingJoin++;continue;}const p=row.payload;if(!Number.isInteger(p?.paidAt)){missingVerifiedTime++;continue;}
  purchases.push({accountHash:row.accountHash,purchaseId:p.purchaseId,verified:true,currency:p.currency,amountPaid:p.amount,paidAt:p.paidAt*1000});
 }
 const summary=summarizeRecoveryExperiment([...byAccount.values()],purchases,now);
 for(const arm of Object.values(summary.arms)){delete arm.refundCents;delete arm.receiptsAfterRefundsCents;delete arm.receiptsPerAssignedCents;arm.grossPerAssignedCents=arm.matureAssigned?arm.grossCents/arm.matureAssigned:null;}
 return {...summary,enrollmentEnabled:experimentEnabled(env),asOf:new Date(now).toISOString(),currency:'usd',refundsAvailable:false,feesAvailable:false,metric:'Verified gross revenue per mature eligible assigned account; not net revenue',missingPurchaseAccountJoin:missingJoin,missingVerifiedPaymentTime:missingVerifiedTime,purchaseCollector:await storage.get('buyerCollectorStatus')||null,recoveryCollector:await storage.get('recoveryCollectorStatus')||null};
}
