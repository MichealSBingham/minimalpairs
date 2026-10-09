import {test,expect} from '@playwright/test';
test('saved free diagnostic reopens one-example report and upgrade on mobile/desktop',async({page},info)=>{
 await page.route(/google-analytics|googletagmanager/,r=>r.abort());
 await page.addInitScript(()=>localStorage.setItem('minimalpairs.progress.v1',JSON.stringify({sessions:[0,1].map(i=>({id:`diagnostic-fixture-${i}`,languageId:'fr',contrastId:'fr-u-y',purpose:'diagnostic',mode:'abx-cross-word',completedAt:'2026-10-09T00:00:00.000Z',correct:0,total:2,mistakes:[{pairId:'fr-ac6782b7609f08ef051b',word:'bu',chosenWord:'tout',correctWord:'tu'}]}))})));
 await page.goto('/practice?language=fr&session=diagnostic&report=2026-10-09T00%3A00%3A00.000Z#diagnostic-history');
 const report=page.locator('.diagnostic-history details');await expect(report).toHaveAttribute('open','');
 await expect(report.locator('.diagnostic-mistake')).toHaveCount(1);
 await expect(report.locator('.diagnostic-report-gate')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(info.project.name==='mobile'?390:1440);
 await page.screenshot({path:`/tmp/mp-report-gate-${info.project.name}.png`,fullPage:true});
});
test('account and canceled checkout keep a safe link back to the saved report',async({page})=>{
 await page.route(/google-analytics|googletagmanager/,r=>r.abort());
 await page.addInitScript(()=>localStorage.setItem('mp.diagnostic-return.v1',JSON.stringify({language:'fr',completedAt:'2026-10-09T00:00:00.000Z',createdAt:Date.now()})));
 for(const path of ['/account','/pricing?billing=cancel']){
  await page.goto(path);
  await expect(page.getByRole('link',{name:'Return to your results'})).toHaveAttribute('href','/practice?language=fr&session=diagnostic&report=2026-10-09T00%3A00%3A00.000Z#diagnostic-history');
 }
});
