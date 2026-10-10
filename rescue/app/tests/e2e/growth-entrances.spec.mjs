import {test,expect} from '@playwright/test';


for(const slug of ['ship-vs-sheep','right-vs-light','thin-vs-sin','tu-vs-tout','banc-vs-bon','poisson-vs-poison']){
 test(`challenge ${slug} plays three different words with a new voice for X`,async({page},info)=>{
  const clips=new Map(),heard=[],errors=[];
  await page.addInitScript(()=>{window.__played=[];const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){window.__played.push(this.src);return original.apply(this,args);};});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async response=>{if(response.url().includes('/manifest.json')){const manifest=await response.json();for(const clip of manifest.clips||[])clips.set(new URL(clip.url,page.url()).pathname,clip);}});
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(/\.(mp3|wav)$/.test(path))heard.push(path);});
  await page.goto(`/challenge/${slug}`);
  const demo=page.locator('.demo-abx');
  if(info.project.name==='mobile'){
   const player=await demo.boundingBox(),explanation=await page.locator('.growth-grid>div').first().boundingBox();
   expect(player.y).toBeLessThan(explanation.y);
  }
  await expect(demo.locator('.demo-answer').first()).toBeDisabled();
  await demo.getByRole('button',{name:'Play A → B → X',exact:true}).click();
  await expect(demo.locator('.abx-heard-mark')).toHaveCount(3);
  const paths=heard.filter((p,i)=>i===0||p!==heard[i-1]);expect(paths).toHaveLength(3);
  const actual=paths.map(p=>clips.get(p));expect(actual.every(Boolean)).toBe(true);
  expect(new Set(actual.map(c=>c.text)).size).toBe(3);
  expect(actual[0].voiceId).toBe(actual[1].voiceId);expect(actual[2].voiceId).not.toBe(actual[0].voiceId);
  await demo.locator('.demo-answer').first().click();
  await expect(demo.getByRole('link',{name:'Practice this contrast'})).toBeVisible();
  await expect(demo.getByRole('button',{name:'Try another round'})).toBeEnabled();
  const playback=await page.evaluate(()=>window.__played);expect(playback).toHaveLength(5);
  const correctIndex=await demo.locator('.demo-answer').evaluateAll(buttons=>buttons.findIndex(b=>b.classList.contains('is-correct')));
  expect(playback[3]).toBe(playback[correctIndex]);expect(playback[4]).toBe(playback[2]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  if(['ship-vs-sheep','tu-vs-tout'].includes(slug))await page.screenshot({path:info.outputPath(`${slug}.png`),fullPage:true});
 });
}
test('acquisition pages have working paths to a diagnostic and pricing on small screens',async({page},info)=>{
 for(const slug of ['minimal-pairs-after-fluent-forever','minimal-pairs-without-anki']){
  await page.goto(`/resources/${slug}`);
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href',new RegExp(`/resources/${slug}$`));
  expect(await page.locator('main a[href="/pricing"]').count()).toBeGreaterThan(0);
  expect(await page.locator('main a[href^="/diagnostic/"]').count()).toBeGreaterThan(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`${slug}.png`),fullPage:true});
 }
});
