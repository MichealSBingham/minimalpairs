// Local fixture + real Google tag. ALL collection and other requests aborted.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const {outputFiles}=await build({stdin:{contents:`import {initializeMeasurement,setAnalyticsChoice,trackMeasurement} from './src/lib/measurement';initializeMeasurement();document.querySelector('button').onclick=()=>{setAnalyticsChoice('allowed');trackMeasurement('plans_view');};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm'});
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try{for(const [label,referrer] of [['Google','https://www.google.com/'],['Reddit','https://www.reddit.com/'],['ChatGPT','https://chatgpt.com/']]){
const context=await browser.newContext({serviceWorkers:'block'}),rows=[];
// Override automation exclusion only in this isolated local fixture.
await context.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false}));
await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
if(url.hostname==='audit.invalid')return route.fulfill({contentType:'text/html',body:`<html lang="en" data-measurement-id="G-82W1PVNSFS" data-measurement-environment="production"><button>Allow analytics in isolated fixture</button><script type="module">${outputFiles[0].text}</script></html>`});
if(url.hostname==='www.googletagmanager.com'&&url.pathname==='/gtag/js')return route.continue();
if(url.pathname.includes('collect'))for(const line of (request.postData()||'').split('\n')){const params=new URLSearchParams(url.search);for(const [k,v]of new URLSearchParams(line))params.set(k,v);rows.push(Object.fromEntries([...params].filter(([k])=>['en','cs','cm','cn','dr','dl','ep.campaign_source','ep.campaign_medium','ep.acquisition_channel'].includes(k))));}
return route.abort();});
const page=await context.newPage();await page.goto('https://audit.invalid/french-minimal-pairs',{referer:referrer});await page.getByRole('button').click();await page.waitForTimeout(6000);results.push({label,rows});await context.close();
}}finally{await browser.close();}
for (const result of results) {
 const expected={Google:['google','organic'],Reddit:['reddit','social'],ChatGPT:['chatgpt','referral']}[result.label];
 assert.ok(result.rows.some(row=>row.en==='page_view'),'Missing real tag collection attempt');
 assert.ok(result.rows.some(row=>row.en==='plans_view'),'Missing real tag event attempt');
 for(const row of result.rows){assert.equal(row.cs,expected[0]);assert.equal(row.cm,expected[1]);assert.equal(row.dr,'');}
}
// Aborted sendBeacon/fetch delivery can trigger fallback attempts; rows are not event counts.
const report={checkedAt:new Date().toISOString(),mode:'local source fixture; real Google tag; all collection requests aborted',results};await writeFile('../qa/attribution-wire-2026-10-08.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
