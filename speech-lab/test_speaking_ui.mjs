// Browser integration tests with existing credited audio as a fake microphone.
// These do not test the user's microphone or pronunciation correctness.
import { chromium } from '../rescue/app/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(root,'qa/speaking-v2/word-regression');await fs.mkdir(out,{recursive:true});
const fixtures='/tmp/minimalpairs-speaking-qa';
const base='http://127.0.0.1:8767';
const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${fixtures}/capture.wav`]});
const checks=[],errors=[];const check=(name)=>checks.push(name);let debugPage;
try{
  const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['microphone'],acceptDownloads:true});
  await context.addInitScript(()=>{const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await get(c);window.__qaTracks=s.getTracks();return s;};});
  const page=await context.newPage();debugPage=page;page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async response=>{if(response.url().includes('/api/measure?')){try{await fs.writeFile(path.join(out,'last-measurement.json'),JSON.stringify(await response.json(),null,2));}catch{}}});
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#record').disabled);check('initial load and engine connection');
  await page.screenshot({path:path.join(out,'desktop-empty.png'),fullPage:true});
  await page.locator('#demo').click();await page.waitForFunction(()=>document.querySelectorAll('.attempt').length===2&&!document.querySelector('#record').disabled);
  assert.equal(await page.locator('[data-attempt-point]').count(),2);check('two real example recordings analyzed and plotted');
  await page.screenshot({path:path.join(out,'desktop-examples.png'),fullPage:true});
  await page.locator('.attempt audio').first().evaluate(a=>a.play());assert.equal(await page.locator('.attempt audio').first().evaluate(a=>a.paused),false);check('audio replay decodes and starts');
  const [exported]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);const exportPath=await exported.path();const data=JSON.parse(await fs.readFile(exportPath,'utf8'));
  assert.equal(data.attempts.length,2);assert.equal(data.attempts[0].kind,'example');assert.equal(data.attempts[0].result.grade,null);assert.ok(!('url' in data.attempts[0]));check('explicit export preserves labels and ungraded measurements');
  await page.locator('#upload').setInputFiles(path.join(fixtures,'silence.wav'));await page.waitForFunction(()=>document.querySelectorAll('.attempt').length===3&&!document.querySelector('#record').disabled);
  assert.match(await page.locator('#feedback').innerText(),/NO POINT/);assert.equal(await page.locator('[data-attempt-point]').count(),1);assert.match(await page.locator('#map').textContent(),/No point for the latest attempt/);check('uncertain attempt adds no stale or fabricated point');
  await page.locator('#clear').click();assert.equal(await page.locator('.attempt').count(),0);assert.equal(await page.locator('[data-attempt-point]').count(),0);check('clear removes replay controls and chart points');
  await page.locator('#record').click();await page.waitForFunction(()=>document.querySelector('#record').textContent==='Stop & compare');
  await page.waitForFunction(()=>document.querySelectorAll('.attempt').length===1&&!document.querySelector('#record').disabled,{},{timeout:20000});
  const [recording]=await Promise.all([page.waitForEvent('download'),page.getByText('Save audio',{exact:true}).click()]);assert.match(recording.suggestedFilename(),/\.wav$/);const bytes=await fs.readFile(await recording.path());assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.ok(bytes.length>1000);
  await fs.writeFile(path.join(fixtures,'browser-captured.wav'),bytes);check('recorded WAV can be explicitly saved');
  assert.match(await page.locator('.attempt .kind').innerText(),/microphone/);assert.equal(await page.locator('[data-attempt-point]').count(),1);
  assert.ok(await page.evaluate(()=>window.__qaTracks.every(t=>t.readyState==='ended')));check('AudioWorklet fake-microphone capture auto-stops, flushes, analyzes, releases tracks');
  await page.route('**/api/measure?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test: engine unavailable'})}));
  await page.locator('#upload').setInputFiles(path.join(fixtures,'ship.wav'));await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Test: engine unavailable'));
  assert.equal(await page.locator('#record').isDisabled(),false);assert.equal(await page.locator('.attempt').count(),2);assert.match(await page.locator('#feedback').innerText(),/could not finish/);assert.equal(await page.locator('[data-attempt-point]').count(),1);await page.unroute('**/api/measure?*');check('server failure preserves replay audio and recovers controls without a false point');
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#record').disabled);assert.equal(await page.locator('.attempt').count(),0);check('recordings are not persisted across reload');
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied for test','NotAllowedError'));});await page.locator('#record').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('not allowed'));
  assert.equal(await page.locator('#upload').isDisabled(),false);check('denied microphone permission offers working file fallback');
  await page.locator('#upload').setInputFiles(path.join(fixtures,'ship.wav'));await page.waitForFunction(()=>document.querySelectorAll('.attempt').length===1&&!document.querySelector('#record').disabled);assert.equal(await page.locator('[data-attempt-point]').count(),1);check('file upload works after microphone denial');
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const mobile=await mobileContext.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base);await mobile.waitForFunction(()=>!document.querySelector('#record').disabled);await mobile.locator('#demo').click();await mobile.waitForFunction(()=>document.querySelectorAll('.attempt').length===2&&!document.querySelector('#record').disabled);
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await mobile.screenshot({path:path.join(out,'mobile-examples.png'),fullPage:true});check('mobile layout has no horizontal overflow and examples work');
  assert.deepEqual(errors,[]);check('no browser JavaScript exceptions');
  await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify({status:'passed',checks,errors,limitations:['Fake microphone uses existing example audio; no physical microphone test.','Mobile is an emulated viewport, not a mobile device.','Playback start verified; no human listening assessment.']},null,2));
  console.log(JSON.stringify({status:'passed',checks},null,2));
}catch(e){if(debugPage)await debugPage.screenshot({path:path.join(out,'failure.png'),fullPage:true});await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify({status:'failed',checks,error:String(e),errors},null,2));throw e;}
finally{await browser.close();}
