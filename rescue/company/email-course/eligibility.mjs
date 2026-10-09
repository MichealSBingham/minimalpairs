// Pure planning only. No network, recipient export, subscription mutation or sends.
export const STEPS = [{id:'day0', day:0}, {id:'day3', day:3}, {id:'day7', day:7}];
const DAY = 86400000;
export function planNext({subscriber, sent=[], now=Date.now(), active=false}) {
  if (!active) return {eligible:false, reason:'campaign-not-approved'};
  if (!subscriber?.id || !subscriber.verified || !subscriber.courseConsentAt || !subscriber.enrollmentId) return {eligible:false, reason:'explicit-verified-consent-required'};
  if (subscriber.unsubscribed || subscriber.bounced || subscriber.complained || subscriber.suppressed) return {eligible:false, reason:'suppressed'};
  const start=Date.parse(subscriber.courseConsentAt);
  if (!Number.isFinite(start) || now<start) return {eligible:false, reason:'invalid-consent-date'};
  const owned=sent.filter(x=>x.subscriberId===subscriber.id);
  if (owned.some(x=>!Number.isFinite(Date.parse(x.sentAt)))) return {eligible:false, reason:'invalid-send-receipt'};
  const last=Math.max(-Infinity,...owned.map(x=>Date.parse(x.sentAt)).filter(Number.isFinite));
  if(now-last<2*DAY) return {eligible:false, reason:'48-hour-spacing'};
  const step=STEPS.find(s=>!owned.some(x=>x.enrollmentId===subscriber.enrollmentId && x.step===s.id));
  if(!step) return {eligible:false, reason:'course-complete'};
  if(now<start+step.day*DAY) return {eligible:false, reason:'not-due'};
  return {eligible:true, step:step.id, variant:subscriber.hasPaidAccess===true?'member':subscriber.hasPaidAccess===false?'free':'neutral',
    includeUpgrade:step.id==='day7' && subscriber.hasPaidAccess===false,
    idempotencyKey:`listening-course-v1:${subscriber.id}:${subscriber.enrollmentId}:${step.id}`};
}
