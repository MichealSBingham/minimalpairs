import {test,expect} from '@playwright/test';
test('free diagnostic samples key contrasts, reveals results, and keeps premium practice gated',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('minimalpairs.analytics-excluded.v1','1');
  window.__diagnosticPlays=[];
  window.Audio=class {constructor(url){this.url=url;}pause(){}play(){window.__diagnosticPlays.push(this.url);setTimeout(()=>this.onended?.(),0);return Promise.resolve();}};
 });
 await page.goto('/practice?language=en&session=diagnostic');
 await expect(page.locator('.diagnostic-preparation')).toContainText('6 sound groups');
 await expect(page.locator('.diagnostic-preparation')).toContainText('12 listening rounds');
 await page.getByRole('button',{name:'Find my starting point',exact:true}).click();
 for(let i=1;i<=12;i++){
  await expect(page.locator('.round-counter')).toHaveText(`${i} / 12`);
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  await page.locator('.answer-card').first().click();
 }
 await expect(page.locator('.diagnostic-results')).toBeVisible();
 await expect(page.locator('.session-results')).toHaveCount(0);
 await expect(page.locator('.diagnostic-donut')).toBeVisible();
 await expect(page.locator('.diagnostic-overview-label .ipa-text')).toHaveCount(6);
 await expect(page.locator('.diagnostic-report-header')).toContainText('of 6 sound groups');
 await expect(page.locator('.diagnostic-offer a')).toHaveAttribute('href','/pricing');
 await expect(page.locator('.diagnostic-word-cell.chosen').first()).toBeVisible();
 await expect(page.locator('.diagnostic-word-cell.correct').first()).toBeVisible();
 const progress=await page.evaluate(()=>JSON.parse(localStorage.getItem('minimalpairs.progress.v1')));
 expect(progress.sessions).toHaveLength(6);
 expect(progress.sessions.every(s=>s.purpose==='diagnostic'&&s.total===2&&s.textHintsUsed===false)).toBe(true);
 expect(await page.evaluate(()=>window.__diagnosticPlays.length)).toBe(12*3);
 expect(progress.sessions.flatMap(s=>s.mistakes).every(m=>m.correctWord&&m.heardIpa&&m.correctIpa)).toBe(true);
 await page.evaluate(()=>document.fonts.load('16px "MinimalPairs IPA"'));
 expect(await page.locator('.ipa-text').first().evaluate(e=>getComputedStyle(e).fontFamily)).toContain('MinimalPairs IPA');
 await page.screenshot({path:`/tmp/minimalpairs-report-${test.info().project.name}.png`,fullPage:true});
 await expect(page.locator('.diagnostic-results')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Unlock practice',exact:false}).first().click();
 await expect(page.getByRole('heading',{name:'Unlock this exercise.'})).toBeVisible();
 await page.screenshot({path:`../qa/diagnostic-${test.info().project.name}.png`,fullPage:true});
});
