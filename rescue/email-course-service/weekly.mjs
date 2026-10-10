import {approvedTemplates,enqueue} from './delivery.mjs';
const WEEK=7*86400000;
/** Enqueue only the next approved tip. Accepted jobs are retained as the delivery ledger. */
export async function scheduleWeekly(storage,env,{now=Date.now(),testTemplates}={}) {
 if(env.SENDING_ENABLED!=='true'||env.WEEKLY_SERIES_READY!=='true')return {queued:0,exhausted:0};
 const templates=testTemplates??approvedTemplates(env);
 return storage.transaction(async tx=>{
  const jobs=[...(await tx.list({prefix:'outbox:',limit:5000})).values()];
  let queued=0,exhausted=0;
  for(const [key,row] of await tx.list({prefix:'subscriber:',limit:5000})){
   if(!['subscribed','verified'].includes(row.status)||!row.weekly||row.consentVersion!=='listening-course-2026-10-09-v3')continue;
   const own=jobs.filter(job=>job.subscriberKey===key);
   const tips=own.filter(job=>job.kind==='weekly');
   // Any unresolved attempt is for the operator to reconcile, never an excuse to send the next tip.
   if(tips.some(job=>job.state!=='accepted'))continue;
   const course=own.filter(job=>job.kind==='course');
   if(row.course&&(['course-day0','course-day3','course-day7'].some(id=>!course.some(job=>job.templateId===id&&job.state==='accepted'))||course.some(job=>job.state!=='accepted')))continue;
   const origin=Date.parse(row.subscribedAt||row.verifiedAt||row.createdAt);
   if(!Number.isFinite(origin))continue;
   const sequence=tips.reduce((last,job)=>Math.max(last,Number(/^weekly-(\d+)$/.exec(job.templateId)?.[1])||0),0)+1;
   const templateId=`weekly-${sequence}`,template=templates[`${templateId}:${row.language}`];
   if(template?.approved!==true){exhausted++;continue;}
   const sent=own.filter(job=>job.state==='accepted').map(job=>job.acceptedAt??job.attemptedAt).filter(Number.isFinite);
   const dueAt=Math.max(origin+(row.course?2:1)*WEEK,(sent.length?Math.max(...sent):origin)+WEEK,Number(row.lastWeeklyAt||0)+WEEK);
   if(dueAt>now)continue;
   const id=`weekly_${key.slice('subscriber:'.length)}_${sequence}`;
   if(await enqueue(tx,{id,subscriberKey:key,templateId,kind:'weekly',dueAt}))queued++;
  }
  const summary={queued,exhausted,checkedAt:now};await tx.put('weeklySchedule',summary);return summary;
 });
}
