export const NEXT_STEP_EXPERIMENT='diag-next-step-v1';
export const NEXT_STEP_KEY='minimalpairs.diag-next-step.v1';
// Independent from the completed score/paywall experiment. Persistent browser allocation.
export function nextStepAssignment(storage,random=Math.random,now=Date.now()){
 try{
  const saved=storage.getItem(NEXT_STEP_KEY);
  if(['control','personalized'].includes(saved))return saved;
  if(now>=Date.parse('2026-10-30T21:00:00Z'))return null;
  const arm=random()<.5?'control':'personalized';storage.setItem(NEXT_STEP_KEY,arm);return arm;
 }catch{return null;} // No durable assignment: keep existing UI, exclude from experiment.
}
export function nextStepFocus(groups){
 return groups.filter(g=>g.results.some(r=>!r.correct)).sort((a,b)=>a.ratio-b.ratio||a.index-b.index)[0]||null;
}
