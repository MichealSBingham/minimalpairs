import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const bank=JSON.parse(fs.readFileSync(new URL('../../src/data/us-chatterbox-curriculum.json',import.meta.url)));
test('free exercise access survives direct links and language changes without query-string upgrades',async({page})=>{
 await page.goto('/practice/?language=en&contrast='+bank.contrasts[3].id+'&plan=lifetime');
 await expect(page.getByRole('heading',{name:'Unlock this exercise.'})).toBeVisible();
 await expect(page.locator('.practice-sidebar .contrast-option')).toHaveCount(bank.contrasts.length);
 await expect(page.getByRole('region',{name:'Exercise library'})).toHaveCount(0);
 const analytics=page.getByRole('button',{name:'Keep analytics off'});
 if(await analytics.isVisible())await analytics.click();
 await page.getByRole('button',{name:'Exercise 01',exact:true}).click();
 await expect(page.getByRole('button',{name:'Start with A, B & X'})).toBeVisible();
 await page.getByRole('button',{name:'Exercise 04 · Locked',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Unlock this exercise.'})).toBeVisible();
 await page.getByLabel('I’m learning').selectOption('ja');
 await expect(page.getByRole('button',{name:'Start with A, B & X'})).toBeVisible();
});
