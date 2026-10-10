import {chromium} from '../../app/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try {
 for(const [path,bank,width] of [['/learn/en-i-ih','en-US-ga',1440],['/learn/fr-u-y','fr',390],['/account','fr',390]]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.addInitScript(()=>localStorage.setItem('minimalpairs.analytics-excluded.v1','true'));
  await context.route('**/usage',route=>route.abort());
  let captured;
  await context.route('https://minimalpairs-email-course.sirmichealbingham.workers.dev/subscribe',async route=>{
   captured=route.request().postDataJSON();
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({received:true}),headers:{'Access-Control-Allow-Origin':'https://minimalpairs.co'}});
  });
  const page=await context.newPage();
  await page.goto('https://minimalpairs.co'+path,{waitUntil:'domcontentloaded'});
  const form=page.locator('.email-course-signup');
  await form.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const f=document.querySelector('.email-course-signup');return f && !f.closest('astro-island')?.hasAttribute('ssr');});
  assert.equal(await form.getByRole('combobox').inputValue(),bank);
  await form.getByRole('textbox',{name:'Email address',exact:true}).fill('course-ui-check@example.com');
  await form.getByRole('button',{name:'Send my listening plan',exact:true}).click();
  await form.getByText('Your subscription request has been saved.',{exact:true}).waitFor();
  assert.deepEqual(captured,{email:'course-ui-check@example.com',language:bank,course:true,weekly:true,consentVersion:'listening-course-2026-10-09-v3'});
  assert.equal(await form.getByRole('button',{name:'Request saved',exact:true}).isDisabled(),true);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
  assert.equal(overflow,false);
  results.push({path,bank,width,status:'passed',subscriptionRequest:'intercepted; never sent to production'});
  await context.close();
 }
} finally {await browser.close();}
fs.writeFileSync(new URL('course-ui-verification.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results,realSubscribersCreated:0,emailsSent:0,scope:'Live deployed UI with intercepted subscription responses; not proof of first real subscriber delivery'},null,2)+'\n');
console.log(JSON.stringify(results));
