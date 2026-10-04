import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const baseURL=process.env.MINIMALPAIRS_TEST_URL || 'http://127.0.0.1:4323';
test.use({baseURL});
const observed=new WeakMap();
const KEY='minimalpairs.phoneme-pools.v1';
test.beforeEach(async({page})=>{
  const events={audio:[],errors:[]};observed.set(page,events);
  page.on('pageerror',e=>events.errors.push(e.message));
  page.on('request',r=>{if(r.resourceType()==='media'||new URL(r.url()).pathname.startsWith('/audio/'))events.audio.push(r.url());});
  await page.exposeBinding('__mediaAttempt',(_source,event)=>events.audio.push(event));
  await page.addInitScript(()=>{
    window.Audio=new Proxy(window.Audio,{construct(target,args){void window.__mediaAttempt('Audio');return Reflect.construct(target,args);}});
    HTMLMediaElement.prototype.play=function(){void window.__mediaAttempt('play');return Promise.resolve();};
    if(window.speechSynthesis)speechSynthesis.speak=()=>void window.__mediaAttempt('synthesis');
  });
});
test.afterEach(async({page},testInfo)=>{
  expect(observed.get(page)).toEqual({audio:[],errors:[]});
  await expect(page.locator('audio,video')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await testInfo.attach('no-audio-evidence',{body:JSON.stringify(observed.get(page)),contentType:'application/json'});
});
async function open(page,query=''){
  await page.goto(`/word-review${query}`);
  await expect(page.getByRole('button',{name:'Export review',exact:true})).toBeEnabled();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',/noindex/);
  await expect(page.locator('html')).toHaveAttribute('data-measurement-id','');
}
async function backup(page){
  const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Export review',exact:true}).click();
  const downloaded=await waiting;return JSON.parse(await readFile(await downloaded.path(),'utf8'));
}
async function importBackup(page,data){await page.locator('input[type=file]').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});}

test('nine-language review shows independent pools, a full contrast map and documented sources',async({page},testInfo)=>{
  await open(page);
  await expect(page.getByRole('navigation',{name:'Pronunciation bank'}).getByRole('button')).toHaveCount(10);
  await expect(page.locator('.pr-detail')).toHaveCount(1);
  await expect(page.locator('.pr-pool')).toHaveCount(2);
  await expect(page.locator('.pr-detail')).toHaveAttribute('data-contrast-id','en-i-ih');
  await expect(page.locator('.pr-pool').first().locator('.pr-word')).toHaveCount(14);
  await expect(page.locator('.pr-pool').nth(1).locator('.pr-word')).toHaveCount(14);
  await expect(page.locator('.pr-pool-instruction')).toContainText('rows across the columns are not fixed pairs');
  await page.screenshot({path:testInfo.outputPath('english-word-pools.png'),fullPage:true});
  await page.getByRole('button',{name:'All American English contrasts',exact:true}).click();
  expect(await page.locator('tbody tr').count()).toBeGreaterThanOrEqual(26);
  await expect(page.getByRole('heading',{name:'American English: the contrast map'})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('english-contrast-map.png')});
  await page.getByRole('navigation',{name:'Pronunciation bank'}).getByRole('button',{name:/^French/}).click();
  await expect(page.getByRole('navigation',{name:'Pronunciation bank'}).getByRole('button',{name:/^French/})).toHaveCSS('background-color','rgb(37, 42, 45)');
  await expect(page.locator('.pr-detail')).toHaveCount(1);
  await page.getByRole('searchbox',{name:'Find a sound or word'}).fill('tout');
  await expect(page.locator('.pr-detail')).toContainText('tout');
  await page.screenshot({path:testInfo.outputPath('french-word-pools.png')});
  await page.getByRole('navigation',{name:'Pronunciation bank'}).getByRole('button',{name:/^Mandarin/}).click();
  expect(await page.locator('.pr-reading').count()).toBeGreaterThan(0);
  await page.screenshot({path:testInfo.outputPath('mandarin-word-pools.png')});
  const response=await page.request.get('/data/phoneme-library.json');expect(response.ok()).toBe(true);
  const library=await response.json();expect(library.languages.length).toBe(9);expect(library.counts.documentedStimulusMemberships).toBeGreaterThan(0);
  await expect(page.getByRole('link',{name:'Earlier review & notes ↗'})).toHaveAttribute('href','/word-review-previous');
});

test('word and contrast corrections persist, export and import without changing previous reviews',async({page},testInfo)=>{
  await open(page,'?contrast=en-r-l');
  await expect(page.locator('.pr-detail')).toHaveAttribute('data-contrast-id','en-r-l');
  const old='preserve previous notes';await page.evaluate(value=>{localStorage.setItem('minimalpairs.word-review.v1',value);localStorage.setItem('minimalpairs.audio-review.v1',value);},old);
  const word=page.locator('.pr-word').first();const spelling=await word.locator('strong').innerText();
  await word.locator('summary').click();
  await word.getByLabel(`Review word ${spelling}`,{exact:true}).selectOption('fix');
  await word.getByLabel(`Note for word ${spelling}`,{exact:true}).fill('Check the intended pronunciation.');
  await page.getByLabel('Review this contrast',{exact:true}).selectOption('unsure');
  await page.getByLabel('Contrast corrections or missing words',{exact:true}).fill('Add more initial words after checking.');
  const saved=await backup(page);expect(saved.kind).toBe('minimalpairs-sound-pool-review');
  expect(Object.values(saved.reviewState.wordReviews)[0].status).toBe('fix');
  expect(Object.values(saved.reviewState.contrastReviews)[0].note).toContain('Add more');
  await page.reload();await expect(page.getByRole('button',{name:'Export review',exact:true})).toBeEnabled();
  await expect(page.getByLabel('Review this contrast',{exact:true})).toHaveValue('unsure');
  await expect(page.locator('.pr-saved-note').first()).toHaveText('Check the intended pronunciation.');
  const unknown=structuredClone(saved);unknown.reviewState.wordReviews.changed={status:'pass',note:'Unknown',updatedAt:new Date().toISOString()};
  await importBackup(page,unknown);await expect(page.getByRole('status')).toContainText('1 changed entries');
  expect(Object.keys(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),KEY)).clipReviews)).not.toContain('changed');
  await importBackup(page,{kind:'minimalpairs-word-review',reviewState:{schemaVersion:1}});
  await expect(page.getByRole('status')).toContainText('Choose a sound-pool review backup');
  expect(await page.evaluate(()=>localStorage.getItem('minimalpairs.word-review.v1'))).toBe(old);
  expect(await page.evaluate(()=>localStorage.getItem('minimalpairs.audio-review.v1'))).toBe(old);
  await page.screenshot({path:testInfo.outputPath('saved-pool-correction.png')});
  await page.emulateMedia({media:'print'});await page.screenshot({path:testInfo.outputPath('pool-print.png'),fullPage:true});
});

test('search, mobile contrast selection and next contrast keep the review attached to the visible words',async({page},testInfo)=>{
  await open(page);
  await page.getByRole('searchbox',{name:'Find a sound or word'}).fill('missing-qa-word');
  await expect(page.getByText('No matching contrast in American English.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await page.getByRole('button',{name:'Next contrast →',exact:true}).click();
  await expect(page.locator('.pr-detail')).toHaveAttribute('data-contrast-id','en-r-l');
  await expect(page).toHaveURL(/contrast=en-r-l/);
  await page.reload();await expect(page.locator('.pr-detail')).toHaveAttribute('data-contrast-id','en-r-l');
  if(testInfo.project.name==='mobile'){
    await page.getByLabel('Sound contrast',{exact:true}).selectOption('en-th-s');
  }else{
    await page.locator('.pr-contrast-nav button').filter({hasText:'/θ/ — /s/'}).click();
  }
  await expect(page.locator('.pr-detail')).toHaveAttribute('data-contrast-id','en-th-s');
});

test('vowel coverage and Russian coupled-cue warning survive review exports',async({page},testInfo)=>{
  await open(page,'?contrast=ru-y-i');
  await expect(page.locator('.pr-detail')).toHaveAttribute('data-contrast-id','ru-y-i');
  await expect(page.locator('.pr-contrast-scope')).toBeVisible();
  await expect(page.locator('.pr-contrast-scope')).toContainText(/consonant|onset/);
  await expect(page.locator('.pr-word[data-word="мыл"]')).toBeVisible();
  await expect(page.locator('.pr-word[data-word="мил"]')).toBeVisible();
  await expect(page.getByText('Minimal-pair links for the separate word game (0)',{exact:true})).toBeVisible();
  const saved=await backup(page),ru=saved.library.contrasts.find(c=>c.id==='ru-y-i');
  expect(ru.scopeNote).toBeTruthy();expect(ru.minimalPairs).toHaveLength(0);
  await page.locator('.pr-tools summary').click();
  const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'All word lists (CSV)',exact:true}).click();
  const csv=await readFile(await(await waiting).path(),'utf8');
  expect(csv.split('\n')[0]).toContain('contrast_scope_note');expect(csv).toContain(ru.scopeNote.replaceAll('"','""'));
  await page.screenshot({path:testInfo.outputPath('russian-yi-scope.png'),fullPage:true});
  await page.getByRole('navigation',{name:'Pronunciation bank'}).getByRole('button',{name:/^Spanish/}).click();
  await page.getByRole('button',{name:'All Spanish contrasts',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(18);
  await page.screenshot({path:testInfo.outputPath('spanish-expanded-map.png'),fullPage:true});
  await page.locator('.pr-method summary').click();
  await expect(page.locator('.pr-method')).toContainText('ABX discrimination:');
  await expect(page.locator('.pr-method')).toContainText('Both tasks have research support');
});

test('English banks stay separate through legacy links, reload and bank changes',async({page},testInfo)=>{
  await open(page,'?language=en&variety=en-GB-ssbe');
  const banks=page.getByRole('navigation',{name:'Pronunciation bank'});
  await expect(banks.getByRole('button',{name:/^British English/})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.pr-detail-heading')).toContainText(/British/);
  await expect(page.locator('.pr-depth')).toContainText('four is the minimum');
  await expect(page.locator('.pr-release')).toContainText('scope settled');
  const before=await page.locator('.pr-detail').getAttribute('data-contrast-id');
  await page.reload();await expect(page.getByRole('button',{name:'Export review',exact:true})).toBeEnabled();
  await expect(banks.getByRole('button',{name:/^British English/})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.pr-detail')).toHaveAttribute('data-contrast-id',before);
  await banks.getByRole('button',{name:/^American English/}).click();
  await expect(page.locator('.pr-detail-heading')).toContainText('American');
  await expect(page).toHaveURL(/bank=en-US-ga/);
  await page.getByRole('button',{name:'All American English contrasts',exact:true}).click();
  const american=await page.locator('tbody tr').count();
  await expect(page.locator('tbody')).not.toContainText('Southern British');
  await banks.getByRole('button',{name:/^British English/}).click();
  await page.getByRole('button',{name:'All British English contrasts',exact:true}).click();
  expect(await page.locator('tbody tr').count()).toBeGreaterThan(2);
  await expect(page.locator('tbody')).not.toContainText('General American');expect(american).toBe(27);
  await page.screenshot({path:testInfo.outputPath('separate-british-bank.png')});
  await open(page,'?language=fr&contrast=fr-eh-in');
  await expect(page.locator('.pr-pool').nth(1).locator('header')).toContainText('5 words · 4 IPA forms');
});

test('Japanese bank and frozen release survive deep links and review exports',async({page},testInfo)=>{
  await open(page,'?language=ja');
  await expect(page.getByRole('navigation',{name:'Pronunciation bank'}).getByRole('button',{name:/^Japanese/})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.pr-detail-heading')).toContainText('Japanese');
  expect(await page.locator('.pr-reading').count()).toBeGreaterThanOrEqual(8);
  const snapshot=await backup(page),japanese=snapshot.library.contrasts.filter(c=>c.languageId==='ja');
  expect(japanese.length).toBeGreaterThanOrEqual(8);expect(japanese.every(c=>c.depth.meetsMinimum&&c.depth.hasMinimumContext)).toBe(true);
  expect(snapshot.library.release.id).toBe('text-bank-v2');expect(snapshot.library.release.libraryFingerprint).toBe(snapshot.libraryFingerprint);
  expect(snapshot.library.release.audioGenerated).toBe(0);
  const archiveResponse=await page.request.get('/data/text-bank-v2.json');expect(archiveResponse.ok()).toBe(true);
  expect(await archiveResponse.json()).toEqual(snapshot.library);
  expect(japanese.every(c=>c.pools.flat().every(m=>snapshot.library.words[m.wordId].reading))).toBe(true);
  await expect(page.locator('.pr-attribution')).toContainText('JMdict');
  await expect(page.locator('.pr-reading').first()).toContainText(/ · /);
  expect(snapshot.library.banks.filter(b=>b.languageId==='en').map(b=>b.id).sort()).toEqual(['en-GB-ssbe','en-US-ga']);
  await page.screenshot({path:testInfo.outputPath('japanese-word-bank.png'),fullPage:true});
  await page.getByRole('button',{name:'Next contrast →',exact:true}).click();
  const contrast=await page.locator('.pr-detail').getAttribute('data-contrast-id');await expect(page).toHaveURL(/bank=ja/);
  await page.reload();await expect(page.locator('.pr-detail')).toHaveAttribute('data-contrast-id',contrast);
});
