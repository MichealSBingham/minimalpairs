import { test, expect } from '@playwright/test';

// All page/module traffic comes from the local dev build. No request reaches a
// customer origin or Google. The non-local secure TEST origin lets us exercise
// opt-in without weakening production localhost/WebDriver exclusion rules.
const origin = 'https://analytics-fixture.test';
const local = process.env.MINIMALPAIRS_ANALYTICS_FIXTURE_URL || 'http://127.0.0.1:4327';
test.beforeEach(async ({page}) => {
 test.skip(!process.env.MINIMALPAIRS_ANALYTICS_FIXTURE_URL, 'Start an analytics-enabled local dev server and set MINIMALPAIRS_ANALYTICS_FIXTURE_URL.');
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin){
   const response=await route.fetch({url:local+url.pathname+url.search});
   return route.fulfill({response});
  }
  if(url.hostname==='www.googletagmanager.com') return route.fulfill({contentType:'application/javascript',body:'/* mocked Google tag; assertions inspect queued payloads */'});
  return route.abort();
 });
 await page.addInitScript(()=>{
  if(location.hostname==='analytics-fixture.test') Object.defineProperty(navigator,'webdriver',{get:()=>false});
 });
});
const events=page=>page.evaluate(()=>Array.from(window.dataLayer||[]).map(v=>Array.from(v)).filter(v=>v[0]==='event').map(v=>({name:v[1],data:v[2]})));
async function boot(page,path='/pricing'){
 await page.goto(origin+path);
 await page.evaluate(async()=>{window.measurement=await import('/src/lib/measurement.ts');});
}

test('real browser consent, prefixed full diagnostic, privacy and exclusion',async({page})=>{
 const google=[];page.on('request',r=>{if(r.url().includes('googletagmanager.com'))google.push(r.url());});
 await boot(page,'/pricing?private_probe=secret#hidden');
 expect(google).toEqual([]);
 expect(await events(page)).toEqual([]);
 await page.evaluate(()=>measurement.setAnalyticsChoice('allowed'));
 await expect.poll(()=>google.length).toBe(1);
 await page.evaluate(()=>{
  const id='diagnostic-00000000-0000-4000-8000-000000000001';
  const d={language_id:'ja',session_kind:'diagnostic',activity_mode:'abx-cross-word',total:12,groups_count:6,audio_collection:'chatterbox-ja-four-voices-v1'};
  measurement.startMeasuredPractice(id,d);
  measurement.startMeasuredPractice(id,d);
  measurement.trackMeasuredPracticeEvent('diagnostic_start',{...d,attempt_id:id});
  measurement.measuredFirstAnswer(id,false);
  measurement.completeMeasuredPractice(id,{correct:9,total:12});
  measurement.completeMeasuredPractice(id,{correct:9,total:12});
  measurement.trackMeasuredPracticeEvent('diagnostic_complete',{attempt_id:id,correct:9,total:12});
 });
 let rows=await events(page);
 expect(rows.filter(v=>v.name==='practice_start')).toHaveLength(1);
 expect(rows.filter(v=>v.name==='practice_complete')).toHaveLength(1);
 expect(rows.find(v=>v.name==='practice_complete').data).toMatchObject({correct:9,total:12,session_kind:'diagnostic',language_id:'ja'});
 expect(JSON.stringify(rows)).not.toMatch(/private_probe|secret|hidden/);
 expect(rows.every(v=>!v.data.page_location.includes('?')&&!v.data.page_location.includes('#'))).toBe(true);
 await page.evaluate(()=>measurement.setAnalyticsExcluded(true));
 const count=(await events(page)).length;
 await page.evaluate(()=>{measurement.trackMeasurement('plan_selected',{plan:'monthly'});measurement.setAnalyticsChoice('allowed');measurement.trackMeasurement('support_submitted',{topic:'billing'});});
 expect((await events(page)).length).toBe(count);
 await page.reload();await page.evaluate(async()=>{window.measurement=await import('/src/lib/measurement.ts');});
 expect(await page.evaluate(()=>measurement.analyticsExcluded())).toBe(true);
 expect(await events(page)).toEqual([]);
});

test('late consent does not invent session completion; visible plans count once',async({page})=>{
 await boot(page);
 await page.evaluate(()=>{
  const id='mixed-00000000-0000-4000-8000-000000000002';
  measurement.startMeasuredPractice(id,{language_id:'fr',session_kind:'mixed',activity_mode:'word-identification',total:6});
  measurement.setAnalyticsChoice('allowed');
  measurement.completeMeasuredPractice(id,{correct:4,total:6});
  measurement.trackMeasuredPracticeEvent('practice_group_complete',{attempt_id:id,contrast_id:'fr-u-y',correct:2,total:3});
 });
 expect((await events(page)).some(v=>v.name==='practice_complete'||v.name==='practice_group_complete')).toBe(false);
 const card=page.locator('.plan-monthly');await expect(card).toBeVisible();await card.scrollIntoViewIfNeeded();
 await expect.poll(async()=>(await events(page)).filter(v=>v.name==='plans_view').length).toBe(1);
 await page.evaluate(()=>{measurement.setAnalyticsChoice('allowed');window.dispatchEvent(new Event('resize'));});
 expect((await events(page)).filter(v=>v.name==='plans_view')).toHaveLength(1);
 await page.evaluate(()=>measurement.setAnalyticsChoice('declined'));
 const count=(await events(page)).length;
 await page.evaluate(()=>measurement.trackMeasurement('begin_checkout',{plan:'lifetime',surface:'pricing'}));
 expect((await events(page)).length).toBe(count);
});

test('British guides and every localized diagnostic retain safe page paths',async({page})=>{
 await boot(page);
 const paths=await page.evaluate(async()=>{
  const {measurementPath}=await import('/src/lib/measurement-data.ts');
  return ['','/es','/fr','/pt','/de','/it','/ru','/ja','/zh'].flatMap(prefix=>[
   `${prefix}/british-english-minimal-pairs`,`${prefix}/learn/en-thought-lot-gb`,`${prefix}/diagnostic/ja`
  ]).map(path=>({path,clean:measurementPath(path+'?email=private#secret')}));
 });
 expect(paths.every(v=>v.path===v.clean)).toBe(true);
});
