import {test,expect} from '@playwright/test';
import {productAnalytics} from '../../../audio-reports/product-analytics.mjs';
test('declined Google Analytics still reports partial practice without adding production test traffic',async({page})=>{
 const records=[],google=[],map=new Map();
 const storage={get:async k=>structuredClone(map.get(k)),put:async(k,v)=>map.set(k,structuredClone(v)),transaction:async f=>f(storage),getAlarm:async()=>0,setAlarm:async()=>{}};
 await page.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false});localStorage.setItem('minimalpairs.analytics-choice.v1','declined');localStorage.removeItem('minimalpairs.analytics-excluded.v1');});
 await page.route('**/minimalpairs-audio-reports.sirmichealbingham.workers.dev/**',route=>route.abort());
 await page.route('https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/**',async route=>{
  if(new URL(route.request().url()).pathname!=='/events')return route.abort();
  const body=route.request().postData();records.push(JSON.parse(body));
  const result=await productAnalytics(new Request('https://test/events',{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.99','User-Agent':'Mozilla isolated verification'},body}),storage,{REPORTING_TOKEN:'test-only-key'});
  await route.fulfill({status:result.status,contentType:'application/json',body:await result.text(),headers:{'Access-Control-Allow-Origin':'*'}});
 });
 page.on('request',r=>{if(/google-analytics\.com|googletagmanager\.com/.test(r.url()))google.push(r.url());});
 await page.goto('/practice?language=fr&contrast=fr-u-y');
 await expect.poll(()=>records.some(r=>r.event==='page_view')).toBe(true);
 await page.getByRole('button',{name:'Start with A, B & X',exact:true}).click();
 const answer=page.locator('.abx-answer-options .answer-card').first();await expect(answer).toBeEnabled({timeout:30000});await answer.click();
 await expect.poll(()=>records.some(r=>r.event==='practice_answer')).toBe(true);
 // Verify a cached-page exit while the test can still observe its request.
 // Actual tab teardown may drop an exit: submitted answers remain durable regardless.
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
 await expect.poll(()=>records.some(r=>r.event==='practice_exit')).toBe(true);
 await page.goto('/pricing');
 expect(google).toEqual([]);
 expect(records.find(r=>r.event==='practice_answer')).toMatchObject({language:'fr',contrast:'fr-u-y',round:0});
 expect(records.some(r=>r.event==='practice_complete')).toBe(false);
 const stats=[...map.entries()].find(([k])=>k.startsWith('productDay:'))[1];expect(stats.funnel.practiceStarted).toBe(1);expect(stats.funnel.answered).toBe(1);expect(stats.funnel.completed).toBe(0);
 expect(JSON.stringify(records)).not.toMatch(/@|firebaseUid|customer_email/);
});
