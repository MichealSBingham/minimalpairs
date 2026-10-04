import { test, expect } from '@playwright/test';
import { keepAnalyticsOff } from './analytics-choice.mjs';

const manifestPath = '/audio/fixed-reference-expansion/manifest.json';
const scopes = [
  { id: 'en-zh-j', pairs: [['lesion','legion'],['pleasure','pledger'],['version','virgin']] },
  { id: 'en-foot-strut', pairs: [['put','putt'],['look','luck'],['book','buck']] },
  { id: 'en-ae-strut', pairs: [['cat','cut'],['cap','cup'],['lack','luck']] },
];
for (const scope of scopes) test(`${scope.id} owner preview resolves real cross-word ABX without text or source mixing`, async ({ page, context }, info) => {
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const media = [], errors = [], manifests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()).pathname; if (/^\/audio\/.*\.mp3$/.test(url)) media.push(url); if (/^\/audio\/.*\.json$/.test(url)) manifests.push(url); });
  await page.route(/(google-analytics|googletagmanager)\.com/, route => route.abort());
  await page.goto(`/english-audio-preview?language=en&contrast=${scope.id}`); await keepAnalyticsOff(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('.owner-audio-notice')).toContainText('Synthetic English audio');
  await expect(page.locator('.owner-audio-notice')).toContainText('unreviewed');
  await expect(page.locator('.contrast-option')).toHaveCount(3);
  await expect(page.locator('#practice-language option')).toHaveCount(1);
  const manifest = await (await page.request.get(manifestPath)).json();
  expect(manifest.clips).toHaveLength(34);
  const byPath = new Map(manifest.clips.map(clip => [clip.url, clip]));
  const words = scope.pairs.flat();
  const start = page.getByRole('button', { name: 'Start with A, B & X' }); await expect(start).toBeEnabled();
  if (scope.id === 'en-zh-j') await page.screenshot({ path: info.outputPath('owner-english-ready.png'), fullPage: true });
  media.length = 0; await start.click();
  const answer = page.locator('.abx-answer-options .answer-card').first();
  const full = scope.id === 'en-zh-j'; let expectedCorrect = 0; const observed = [];
  for (let round = 1; round <= (full ? 12 : 3); round++) {
    await expect(answer).toBeEnabled(); await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
    await expect(page.locator('.abx-word-hint')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Show text hints' })).not.toBeChecked();
    await expect(page.locator('.trainer-card h2')).toHaveText(`Sound contrast ${String(scopes.indexOf(scope) + 1).padStart(2,'0')}`);
    const visible = await page.locator('body').innerText();
    const accessible = await page.locator('body').ariaSnapshot();
    for (const word of words) { const regex = new RegExp(`\\b${word}\\b`, 'i'); expect(visible).not.toMatch(regex); expect(accessible).not.toMatch(regex); }
    const paths = media.filter((url, index) => index === 0 || url !== media[index - 1]); expect(paths).toHaveLength(3);
    const clips = paths.map(url => byPath.get(url)); expect(clips.every(Boolean)).toBe(true);
    expect(clips.every(clip => clip.synthetic === true && clip.status === 'generated-unreviewed' && words.includes(clip.text))).toBe(true);
    expect(clips[0].voiceId).toBe(clips[1].voiceId); expect(clips[2].voiceId).not.toBe(clips[0].voiceId);
    expect(clips[2].text).not.toBe(clips[0].text); expect(clips[2].text).not.toBe(clips[1].text);
    const category = word => scope.pairs.find(pair => pair.includes(word)).indexOf(word);
    const correct = category(clips[0].text) === category(clips[2].text); expectedCorrect += Number(correct);
    if (round === 1) {
      observed.push({ scope: scope.id, paths, profiles: clips.map(clip => clip.voiceId) });
      if (scope.id === 'en-zh-j') await page.screenshot({ path: info.outputPath('owner-english-active.png'), fullPage: true });
      if (info.project.name === 'mobile') expect((await page.locator('.abx-answer-options').boundingBox()).y + (await page.locator('.abx-answer-options').boundingBox()).height).toBeLessThanOrEqual(844);
    }
    await answer.click(); await expect(page.locator('.answer-feedback strong')).toHaveText(correct ? 'You heard the shared feature.' : 'X shares B’s target feature.');
    if (full || round < 3) { media.length = 0; await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click(); }
  }
  expect(manifests.every(url => url === manifestPath)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (full) {
    await expect(page.locator('.session-complete a[href^="/practice?"]')).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.progress.v1')).sessions);
    expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ audioCollectionId: 'owner-fixed-reference-english-v1', languageId: 'en', contrastId: scope.id, total: 12, correct: expectedCorrect, textHintsUsed: false });
    await page.getByRole('link', { name: 'View your history', exact: true }).click();
    await expect(page.locator('.history-row')).toContainText('English synthetic preview');
    const revisit = page.locator('.history-description a'); await expect(revisit).toHaveAttribute('href', `/english-audio-preview?language=en&contrast=${scope.id}`);
    await page.reload(); await expect(revisit).toHaveAttribute('href', `/english-audio-preview?language=en&contrast=${scope.id}`); await revisit.click();
    await expect(start).toBeEnabled(); await expect(page.getByRole('checkbox', { name: 'Show text hints' })).not.toBeChecked();
    await page.getByRole('link', { name: 'Review notes & sources' }).click();
    await expect(page.locator('#owner-english-preview')).toContainText('shared-schwa');
    await expect(page.locator('#owner-english-preview')).toContainText('Lesion.');
    await expect(page.locator('#owner-english-preview')).toContainText('clipping check');
    await expect(page.locator('#owner-english-preview')).toContainText('not access-controlled');
  }
  expect(errors).toEqual([]);
  await info.attach('owner-audio-observations', { body: JSON.stringify({ observed, fullSession: full, pronunciationVerified: false, sourceIsolated: true }, null, 2), contentType: 'application/json' });
  await cdp.detach();
});

test('unavailable owner manifest cannot fall back to ordinary or device audio', async ({ page }) => {
  const requests = []; page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.route(`**${manifestPath}`, route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/english-audio-preview'); await keepAnalyticsOff(page);
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeDisabled();
  await expect(page.locator('.voice-description')).toContainText('No complete audio voice is available');
  expect(requests).not.toContain('/audio/manifest.json'); expect(requests.filter(url => url.endsWith('.mp3'))).toEqual([]);
});
