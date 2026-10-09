import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route(/google-analytics|googletagmanager|identitytoolkit.googleapis.com.*accounts:(sendOobCode|signUp|resetPassword|update)/,r=>r.abort());
const report={checkedAt:new Date().toISOString(),viewport:{width:390,height:844},steps:[],errors};
try{
await page.goto('https://minimalpairs.co/practice?language=fr&session=diagnostic');
await page.getByRole('button',{name:'Keep analytics off',exact:true}).click({timeout:2000}).catch(()=>{});
await page.locator('.start-button').click();
for(let round=1;round<=12;round++){
 await page.waitForFunction(n=>document.querySelector('.round-counter')?.textContent===`${n} / 12`,round);
 const choice=page.locator('.abx-answer-options .answer-card:not([disabled])').first();await choice.waitFor({timeout:30000});await choice.click();console.log(`Answered ${round}/12`);
}
await page.locator('.diagnostic-results').waitFor({timeout:15000});
assert.equal(await page.locator('.diagnostic-overview nav a').count(),6);
assert.ok(await page.locator('.diagnostic-secondary-ipa').count());
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
report.steps.push('Completed all 12 real-audio diagnostic rounds; six sound groups, IPA, result chart rendered without overflow.');
await page.locator('.diagnostic-next button').click();await page.locator('.abx-answer-options .answer-card:not([disabled])').first().waitFor({timeout:30000});
report.steps.push('Recommended free lesson launched and real audio unlocked its first answer.');
await page.goto('https://minimalpairs.co/account');
await page.getByRole('button',{name:'Sign in with Google',exact:true}).waitFor();
report.steps.push('Account page exposes Google sign-in. No actual account authorization performed.');
await page.goto('https://minimalpairs.co/pricing');
await page.getByRole('link',{name:'Sign in with Google',exact:true}).first().waitFor();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
report.steps.push('Guest pricing requires sign-in and has no horizontal overflow. Payment not attempted.');
assert.deepEqual(errors,[]);
}finally{await writeFile('../qa/mobile-full-journey-2026-10-08.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(report,null,2));
