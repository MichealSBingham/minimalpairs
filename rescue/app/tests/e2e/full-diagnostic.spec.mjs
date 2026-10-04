import {test,expect} from '@playwright/test';
import {keepAnalyticsOff} from './analytics-choice.mjs';
test('free diagnostic covers the entire bank, reveals results, and keeps premium practice gated',async({page})=>{
 await page.addInitScript(()=>{
  window.__diagnosticPlays=[];
  window.Audio=class {constructor(url){this.url=url;}pause(){}play(){window.__diagnosticPlays.push(this.url);setTimeout(()=>this.onended?.(),0);return Promise.resolve();}};
 });
 await page.goto('/practice?language=en&session=diagnostic');
 await keepAnalyticsOff(page);
 await expect(page.locator('.diagnostic-preparation')).toContainText('27 sound groups');
 await expect(page.locator('.diagnostic-preparation')).toContainText('54 listening rounds');
 await page.getByRole('button',{name:'Find my starting point',exact:true}).click();
 for(let i=1;i<=54;i++){
  await expect(page.locator('.round-counter')).toHaveText(`${i} / 54`);
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  await page.locator('.answer-card').first().click();
 }
 await expect(page.getByRole('heading',{name:'Your results, free',exact:true})).toBeVisible();
 const progress=await page.evaluate(()=>JSON.parse(localStorage.getItem('minimalpairs.progress.v1')));
 expect(progress.sessions).toHaveLength(27);
 expect(progress.sessions.every(s=>s.purpose==='diagnostic'&&s.total===2&&s.textHintsUsed===false)).toBe(true);
 expect(await page.evaluate(()=>window.__diagnosticPlays.length)).toBe(54*3);
 await expect(page.locator('.diagnostic-results')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Unlock practice',exact:false}).first().click();
 await expect(page.getByRole('heading',{name:'Unlock this exercise.'})).toBeVisible();
 await page.screenshot({path:`../qa/diagnostic-${test.info().project.name}.png`,fullPage:true});
});
