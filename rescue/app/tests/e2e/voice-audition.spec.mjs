import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test.use({baseURL:process.env.MINIMALPAIRS_TEST_URL||'http://127.0.0.1:4323'});
test('Mandarin review exposes balanced pools and separate assessment words',async({page})=>{
  await page.goto('/word-review?bank=zh&contrast=zh-tone-2-3');
  await expect(page.getByRole('button',{name:'Export review',exact:true})).toBeEnabled();
  await expect(page.getByRole('region',{name:'Mandarin tone balance'})).toContainText('58 tone words');
  await expect(page.locator('.pr-pool').first().locator('.pr-word')).toHaveCount(14);
  await expect(page.locator('.pr-pool').nth(1).locator('.pr-word')).toHaveCount(14);
  await expect(page.locator('.pr-pools')).not.toContainText('鹰');
  await page.getByText('See the reserved assessment words',{exact:true}).click();
  await expect(page.getByRole('region',{name:'Mandarin tone balance'})).toContainText('鹰');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('audition hides words, supports real playback and saves hash-bound human notes',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const manifest=await(await page.request.get('/audio/voice-audition-v2/manifest.json')).json();
  await page.goto('/voice-audition');
  await expect(page.getByRole('button',{name:'Export your review'})).toBeEnabled();
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content',/noindex/);
  await expect(page.locator('html')).toHaveAttribute('data-measurement-id','');
  await expect(page.getByRole('heading',{name:'What do you hear?'})).toBeVisible();
  await expect(page.locator('.va-main')).not.toContainText(manifest.clips[0].text);
  await expect(page.getByLabel('Review recording A')).toHaveCount(0);
  await expect(page.locator('audio')).toHaveCount(manifest.clips.filter(c=>c.wordId===manifest.clips[0].wordId).length);
  await page.getByRole('button',{name:'Reveal word & pronunciation'}).click();
  await expect(page.locator('.va-word')).toContainText(manifest.clips[0].text);
  await expect(page.getByLabel('Review recording A').locator('option[value=pass]')).toHaveAttribute('disabled','');
  // Real media decoding and an ended event, not an artificial pronunciation pass.
  await page.getByRole('button',{name:'Listen to recording A',exact:true}).click();
  await expect.poll(()=>page.locator('audio').first().evaluate(audio=>/** @type {HTMLAudioElement} */(audio).ended),{timeout:25000}).toBe(true);
  await page.getByLabel('Review recording A').selectOption('unsure');
  await page.getByLabel('Notes for recording A').fill('Owner review needed: check the tone.');
  await page.reload();await expect(page.getByRole('button',{name:'Export your review'})).toBeEnabled();
  await page.getByRole('button',{name:'Reveal word & pronunciation'}).click();
  await expect(page.getByLabel('Notes for recording A')).toHaveValue('Owner review needed: check the tone.');
  const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Export your review'}).click();
  const exported=JSON.parse(await readFile(await(await wait).path(),'utf8'));
  expect(Object.keys(exported.reviews)[0]).toMatch(/:[a-f0-9]{64}$/);
  expect(Object.values(exported.reviews)[0].status).toBe('unsure');
  await page.getByRole('button',{name:'Next word →'}).click();
  await expect(page.getByRole('heading',{name:'What do you hear?'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('voice-audition.png'),fullPage:true});
});

test('changed audio bytes cannot play or receive a pronunciation pass',async({page})=>{
  await page.route('**/audio/voice-audition-v2/clips/*.wav',route=>route.fulfill({status:200,contentType:'audio/wav',body:'not the advertised recording'}));
  await page.goto('/voice-audition');
  await expect(page.getByRole('button',{name:'Export your review'})).toBeEnabled();
  await page.getByRole('button',{name:'Listen to recording A',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('differs from the reviewed inventory');
  await expect(page.locator('audio').first()).not.toHaveAttribute('src',/blob:|https?:/);
  await page.getByRole('button',{name:'Reveal word & pronunciation'}).click();
  await expect(page.getByLabel('Review recording A').locator('option[value=pass]')).toHaveAttribute('disabled','');
});

test('two review tabs preserve independent notes',async({page,context})=>{
  const second=await context.newPage();
  for(const tab of [page,second]){
    await tab.goto('/voice-audition');
    await expect(tab.getByRole('button',{name:'Export your review'})).toBeEnabled();
    await tab.getByRole('button',{name:'Reveal word & pronunciation'}).click();
  }
  await page.getByLabel('Notes for recording A').fill('First tab note');
  await second.getByLabel('Notes for recording B').fill('Second tab note');
  await expect(page.getByLabel('Notes for recording B')).toHaveValue('Second tab note');
  await page.reload();await expect(page.getByRole('button',{name:'Export your review'})).toBeEnabled();
  await page.getByRole('button',{name:'Reveal word & pronunciation'}).click();
  await expect(page.getByLabel('Notes for recording A')).toHaveValue('First tab note');
  await expect(page.getByLabel('Notes for recording B')).toHaveValue('Second tab note');
  await second.close();
});
