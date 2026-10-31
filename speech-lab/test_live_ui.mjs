// Automated browser regression: fake devices only; never the user's microphone.
import {chromium} from '../rescue/app/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out='speech-lab/qa/speaking-v2',base='http://127.0.0.1:8767';
const checks=[],errors=[];let activePage;
async function launch(file='live-capture.wav'){
 return chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=/tmp/minimalpairs-speaking-qa/${file}`]});
}
async function context(browser,mobile=false){
 const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1100},permissions:['microphone'],isMobile:mobile,hasTouch:mobile,acceptDownloads:true});
 await c.addInitScript(()=>{const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__qaTracks=[];
  navigator.mediaDevices.getUserMedia=async options=>{const s=await get(options);window.__qaTracks.push(...s.getTracks());return s;};
 });return c;
}
async function page(c){const p=await c.newPage();activePage=p;p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator('#live-toggle').waitFor();await p.waitForFunction(()=>!document.querySelector('#live-toggle').disabled);return p;}
const browser=await launch();let noisyBrowser;
try{
 const c=await context(browser),p=await page(c);const requests=[];p.on('request',r=>{if(r.url().includes('/api/measure'))requests.push(r.url());});
 await p.screenshot({path:out+'/desktop.png',fullPage:true});
 await p.locator('#live-toggle').click();await p.waitForFunction(()=>document.querySelector('[data-live-point]'),{},{timeout:10000});
 checks.push('real credited speech through fake microphone produces a live dot before stopping');
 await p.screenshot({path:out+'/desktop-live.png',fullPage:true});
 assert.equal(await p.locator('#record').isDisabled(),true);assert.match(await p.locator('#device-info').textContent(),/Hz/);checks.push('input device shown and word recorder cannot overlap live microphone');
 const bounds=await p.locator('#map').boundingBox(),instructions=await p.locator('.live-instruction').boundingBox(),controls=await p.locator('.live-controls').boundingBox();
 assert.ok(bounds.y>=instructions.y+instructions.height-1);assert.ok(controls.y>=bounds.y+bounds.height-1);checks.push('chart, instructions and controls do not overlap');
 await p.waitForFunction(()=>!document.querySelector('[data-live-point]'));checks.push('dot and trail clear when speech becomes uncertain or silent');
 await p.locator('#live-toggle').click();await p.waitForFunction(()=>document.querySelector('#live-toggle').textContent==='Start live view');
 assert.ok(await p.evaluate(()=>window.__qaTracks.every(t=>t.readyState==='ended')));assert.equal(await p.locator('[data-live-point]').count(),0);assert.equal(requests.length,0);assert.equal(await p.locator('.attempt').count(),0);checks.push('pause releases tracks, removes live point, stores no attempt and uploads no audio');
 await p.locator('.input-details summary').click();const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#diagnostics').click()]);
 const report=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.ok(report.live.accepted>0);assert.ok(new Set(report.live.observations.filter(o=>o.accepted).map(o=>Math.round(o.raw_f2_hz))).size>1);assert.ok(report.live.observations.some(o=>!o.accepted));assert.ok(report.live.frames>report.live.accepted);await fs.writeFile(out+'/live-diagnostics.json',JSON.stringify(report,null,2));checks.push('diagnostic export includes measured tracking counts without audio');
 // No API is required for the browser's live path.
 await p.route('**/api/config',r=>r.fulfill({status:503,body:'{}'}));await p.reload();await p.waitForFunction(()=>!document.querySelector('#live-toggle').disabled);
 assert.equal(await p.locator('#record').isDisabled(),true);await p.locator('#live-toggle').click();await p.waitForFunction(()=>document.querySelector('[data-live-point]'),{},{timeout:10000});await p.locator('#live-toggle').click();checks.push('live tracker still runs when the word-analysis API is unavailable');
 await p.unroute('**/api/config');await p.reload();await p.waitForFunction(()=>!document.querySelector('#live-toggle').disabled);
 await p.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('denied','NotAllowedError'));});await p.locator('#live-toggle').click();await p.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('not allowed'));assert.equal(await p.locator('#live-toggle').isDisabled(),false);assert.equal(await p.locator('[data-live-point]').count(),0);checks.push('permission denial gives an actionable message and restores controls');
 // Cancel pending permission; a late stream must be stopped without starting audio.
 await p.reload();await p.waitForFunction(()=>!document.querySelector('#live-toggle').disabled);
 await p.evaluate(()=>{const original=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async options=>{await new Promise(r=>setTimeout(r,500));return original(options);};});
 await p.locator('#live-toggle').click();await p.locator('#live-toggle').click();await p.waitForFunction(()=>window.__qaTracks.length>0&&window.__qaTracks.every(t=>t.readyState==='ended'));assert.equal(await p.locator('[data-live-point]').count(),0);checks.push('cancelled permission request stops late-arriving streams');
 // Input can connect while no audio reaches the processing node.
 await p.reload();await p.waitForFunction(()=>!document.querySelector('#live-toggle').disabled);
 await p.evaluate(()=>{window.AudioWorkletNode=class {constructor(ctx){return Object.assign(ctx.createGain(),{port:{onmessage:null}});}};});
 await p.locator('#live-toggle').click();await p.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('No audio is arriving'),{},{timeout:8000});assert.ok(await p.evaluate(()=>window.__qaTracks.every(t=>t.readyState==='ended')));checks.push('connected but silent processing failure times out with a device-specific recovery message');
 await p.reload();await p.waitForFunction(()=>!document.querySelector('#live-toggle').disabled);
 await p.evaluate(()=>{window.Worker=class {postMessage(){}terminate(){}};});await p.locator('#live-toggle').click();await p.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('stopped responding'),{},{timeout:6000});assert.ok(await p.evaluate(()=>window.__qaTracks.every(t=>t.readyState==='ended')));checks.push('stalled worker times out rather than accumulating audio or leaving a frozen dot');
 await p.reload();await p.waitForFunction(()=>!document.querySelector('#live-toggle').disabled);
 await p.evaluate(()=>{AudioContext.prototype.resume=()=>new Promise(()=>{});});await p.locator('#live-toggle').click();await p.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('Audio did not start'),{},{timeout:7000});assert.ok(await p.evaluate(()=>window.__qaTracks.every(t=>t.readyState==='ended')));checks.push('suspended audio startup times out and releases microphone');
 const mc=await context(browser,true),m=await page(mc);await m.screenshot({path:out+'/mobile.png',fullPage:true});
 const button=await m.locator('#live-toggle').boundingBox(),map=await m.locator('#map').boundingBox();assert.ok(button.y+button.height<=844);assert.ok(map.y+map.height<button.y);assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));checks.push('mobile initial viewport includes the whole chart and start button without horizontal overflow');
 await m.locator('#live-toggle').click();await m.waitForFunction(()=>document.querySelector('[data-live-point]'),{},{timeout:10000});await m.screenshot({path:out+'/mobile-live.png',fullPage:true});await m.locator('#live-toggle').click();checks.push('live dot also works in a mobile-sized touch viewport');
 noisyBrowser=await launch('live-noisy.wav');const nc=await context(noisyBrowser),n=await page(nc);
 await n.locator('#live-toggle').click();await n.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('background level'),{},{timeout:10000});assert.equal(await n.locator('[data-live-point]').count(),0);await n.locator('#live-toggle').click();checks.push('noise observed before speech suppresses a misleading dot with an explicit background-level message');
 assert.deepEqual(errors,[]);checks.push('no browser JavaScript exceptions');
 await fs.writeFile(out+'/live-browser-results.json',JSON.stringify({status:'passed',checks,errors,limitations:['Fake audio devices; no physical microphone or actual phone.','No pronunciation correctness or learning validation.']},null,2));console.log(JSON.stringify({status:'passed',checks},null,2));
}catch(e){if(activePage)await activePage.screenshot({path:out+'/live-failure.png',fullPage:true});await fs.writeFile(out+'/live-browser-results.json',JSON.stringify({status:'failed',checks,error:String(e),errors},null,2));throw e;}
finally{await browser.close();await noisyBrowser?.close();}
