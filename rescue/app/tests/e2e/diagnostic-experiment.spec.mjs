import {test,expect} from '@playwright/test';
for(const previousVariant of ['paid','preview'])test(`preview rollout replaces ${previousVariant} assignment and gates current and saved results`,async({page},info)=>{
 const variant='preview';
 await page.addInitScript(variant=>{
  localStorage.setItem('minimalpairs.analytics-excluded.v1','true');localStorage.setItem('plausible_ignore','true');localStorage.setItem('minimalpairs.analytics-choice.v1','declined');
  localStorage.setItem('minimalpairs.diagnostic-offer.v1',JSON.stringify({experiment:'diag-paywall-v1',variant}));
  // UI flow test only: real catalog/manifests, synthetic instantaneous playback.
  window.__diagnosticPlays=[];window.Audio=class{pause(){}play(){window.__diagnosticPlays.push(this.src);setTimeout(()=>this.onended?.(),0);return Promise.resolve();}};
 },previousVariant);
 await page.route(/google-analytics|googletagmanager|plausible\.io\/api\/event/,r=>r.abort());
 await page.goto('/practice?language=en&session=diagnostic');
 await expect(page.locator('.diagnostic-preparation')).toContainText(variant==='paid'?'Your personal score and report require Premium':'Your score and one example are free');
 await page.locator('.start-button').click();
 for(let round=1;round<=12;round++){
  await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  await page.locator('.answer-card').first().click();
 }
 const results=page.locator('.diagnostic-results');await expect(results).toBeVisible();
 await expect(results.locator('.membership-plans > div').first()).toHaveClass(/plan-lifetime/);
 await expect(results.locator('.diagnostic-overview')).toHaveCount(0);
 const sessions=await page.evaluate(()=>JSON.parse(localStorage.getItem('minimalpairs.progress.v1')).sessions);
 expect(sessions).toHaveLength(6);expect(sessions.every(s=>s.diagnosticExperimentVariant===variant)).toBe(true);
 expect(await page.evaluate(()=>window.__diagnosticPlays.length)).toBe(36);
 if(variant==='paid'){
  await expect(results.locator('.diagnostic-donut')).toHaveCount(0);await expect(results.locator('.diagnostic-mistake')).toHaveCount(0);await expect(results).toContainText('Your report is ready.');
 }else{
  await expect(results.locator('.diagnostic-donut')).toBeVisible();
  await expect(results.locator('.diagnostic-mistake')).toHaveCount(sessions.some(s=>s.mistakes.length)?1:0);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await results.screenshot({path:`/tmp/mp-diagnostic-${variant}-${info.project.name}.png`});
 const date=sessions[0].completedAt;
 await page.goto(`/practice?language=en&session=diagnostic&report=${encodeURIComponent(date)}#diagnostic-history`);
 const history=page.locator('.diagnostic-history details').first();await expect(history).toHaveAttribute('open','');
 if(variant==='paid'){await expect(history.locator('.diagnostic-mistake')).toHaveCount(0);await expect(history.locator('summary').first()).toContainText('Your report is ready.');}
 else await expect(history.locator('.diagnostic-mistake')).toHaveCount(sessions.some(s=>s.mistakes.length)?1:0);
 await history.screenshot({path:`/tmp/mp-diagnostic-history-${variant}-${info.project.name}.png`});
});
