import {test,expect} from '@playwright/test';
test('course advances from audio matching to identification and saves separate progress',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/practice?language=en&contrast=en-i-ih');
 await expect(page.getByRole('button',{name:'Start course',exact:true})).toBeEnabled();
 await page.getByText('Session settings',{exact:true}).click();
 await page.getByRole('combobox',{name:'Session length'}).selectOption('6');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('minimalpairs.session-settings') || '{}').rounds)).toBe(6);
 await page.getByRole('button',{name:'Start course',exact:true}).click();
 for(let round=1;round<=6;round++){
  await expect(page.locator('.round-counter')).toHaveText(`${round} / 6`);
  const answer=page.locator('.answer-card').first();await expect(answer).toBeEnabled();await answer.click();
 }
 await expect(page.getByText('SESSION COMPLETE',{exact:true})).toBeVisible();
 await expect(page.locator('.completion-plans .plan-monthly')).toContainText('$7');
 await expect(page.locator('.completion-plans .plan-lifetime')).toContainText('$29');
 await page.getByRole('button',{name:'Continue my path',exact:true}).click();
 for(let round=1;round<=6;round++){
  await expect(page.locator('.round-counter')).toHaveText(`${round} / 6`);
  await expect(page.locator('.abx-sample')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Which word did you hear?'})).toBeVisible();
  const answer=page.locator('.answer-card').first();await expect(answer).toBeEnabled();await answer.click();
 }
 await expect(page.getByText('SESSION COMPLETE',{exact:true})).toBeVisible();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('minimalpairs.progress.v1')));
 expect(saved.sessions.map(s=>s.mode)).toEqual(['abx-cross-word','word-identification']);
 expect(saved.sessions.map(s=>s.purpose)).toEqual(['focused','focused']);
 expect(saved.sessions[1].textHintsUsed).toBe(true);
 await page.getByRole('button',{name:'Back to my course',exact:true}).click();
 await expect(page.locator('.course-top')).toContainText('2/54');
 await expect(page.locator('.course-trends h3')).toHaveText(['Match the sound','Identify the word']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('.trainer-card').evaluate(e=>e.scrollLeft)).toBe(0);
 expect(errors).toEqual([]);
 await page.screenshot({path:`../qa/course-${test.info().project.name}.png`,fullPage:true});
});
