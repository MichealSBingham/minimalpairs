import {test,expect} from '@playwright/test';
test('short diagnostic has its own navigation, saved history and twelve rounds',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('minimalpairs.progress.v1',JSON.stringify({sessions:[{id:'diagnostic-test-fr-u-y',purpose:'diagnostic',mode:'abx-cross-word',languageId:'fr',contrastId:'fr-u-y',completedAt:'2026-10-07T10:00:00Z',correct:1,total:2,mistakes:[]}]}));localStorage.setItem('minimalpairs.session-settings',JSON.stringify({checkRounds:4}));});
 await page.goto('/practice?language=fr&session=diagnostic');
 const nav=page.locator('.diagnostic-nav');await expect(nav).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.contrast-options .is-selected')).toHaveCount(0);
 await expect(page.locator('.diagnostic-preparation')).toContainText('12');
 await page.getByLabel('What is your first language?').selectOption('Japanese');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('minimalpairs.progress.v1')).nativeLanguage)).toBe('Japanese');
 await expect(page.locator('.session-settings')).toHaveCount(0);
 await expect(page.locator('.diagnostic-history')).toContainText('1 / 2');
 const start=page.getByRole('button',{name:'Retake the check'});
 await expect(start).toBeEnabled();await start.click();
 await expect(page.locator('.round-counter')).toHaveText('1 / 12');
 await page.getByRole('button',{name:'End session'}).click();
 await page.locator('.contrast-options button').first().click();
 await expect(nav).toHaveAttribute('aria-pressed','false');
 await nav.click();await expect(nav).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.diagnostic-history')).toContainText('1 / 2');
});
test('landing shows labeled example results and compact scope',async({page})=>{
 await page.goto('/diagnostic/fr');
 await expect(page.locator('.facts')).toContainText('12');
 await expect(page.locator('.diagnostic-preview-label')).toContainText('Example');
 await expect(page.locator('.diagnostic-preview-bars li')).toHaveCount(6);
 await expect(page.locator('.sound-grid a')).toHaveCount(6);
 await page.screenshot({path:'/tmp/minimalpairs-diagnostic-preview.png',fullPage:true});
});
