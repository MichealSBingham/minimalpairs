import { test, expect } from '@playwright/test';
import { keepAnalyticsOff } from './analytics-choice.mjs';

const sources = [
  { id: 'generated', name: 'Current generated', manifest: '/audio/comparison/generated.json', synthetic: true },
  { id: 'human', name: 'Human recordings', manifest: '/audio/comparison/human.json', synthetic: false },
  { id: 'reference', name: 'Reference-conditioned candidate', manifest: '/audio/fixed-speaker-pilot/manifest.json', synthetic: true },
];

for (const language of ['fr', 'en']) {
  test(`${language} comparison keeps source selection separate through real ABX playback`, async ({ page, context }, testInfo) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const media = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const path = new URL(request.url()).pathname; if (/^\/audio\/.*\.mp3$/.test(path)) media.push(path); });
    await page.goto(`/audio-comparison?language=${language}`);
    await keepAnalyticsOff(page);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('.comparison-status')).toHaveText('Experimental · listening review pending');
    await expect(page.getByLabel('I’m learning')).toHaveValue(language);
    await expect(page.locator('#practice-language option')).toHaveCount(2);
    await expect(page.locator('.contrast-option')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => innerWidth));
    await page.screenshot({ path: testInfo.outputPath(`comparison-${language}-ready.png`), fullPage: true });
    const observations = [];
    for (const source of sources) {
      await page.getByRole('button', { name: new RegExp(source.name) }).click();
      await expect(page.getByRole('button', { name: new RegExp(source.name) })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('I’m learning')).toHaveValue(language);
      await expect(page.locator('.round-counter')).toHaveText('12 listening rounds');
      await expect(page.getByRole('checkbox', { name: 'Show text hints' })).not.toBeChecked();
      await expect(page.locator('.answer-feedback')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
      const manifest = await (await page.request.get(source.manifest)).json();
      const clipByPath = new Map(manifest.clips.map(clip => [clip.url, clip]));
      expect(manifest.clips.filter(clip => clip.languageId === language)).toHaveLength(12);
      media.length = 0;
      await page.getByRole('button', { name: 'Start with A, B & X' }).click();
      const answerA = page.locator('.abx-answer-options .answer-card').nth(0);
      const fullSession = source.id === 'reference' && language === 'fr' && testInfo.project.name === 'desktop';
      let observedCorrect = 0;
      for (let round = 1; round <= (fullSession ? 12 : 1); round++) {
        await expect(answerA).toBeDisabled();
        await expect(answerA).toBeEnabled();
        await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
        await expect(page.locator('.abx-word-hint')).toHaveCount(0);
        await expect(page.locator('.trainer-card h2')).toHaveText('Sound contrast 01');
        const paths = media.filter((path, i) => i === 0 || path !== media[i - 1]);
        expect(paths).toHaveLength(3);
        const clips = paths.map(path => clipByPath.get(path));
        expect(clips.every(Boolean)).toBe(true);
        expect(clips.every(clip => clip.languageId === language && clip.synthetic === source.synthetic)).toBe(true);
        expect(clips[0].voiceId).toBe(clips[1].voiceId);
        expect(clips[2].voiceId).not.toBe(clips[0].voiceId);
        expect(clips[2].text).not.toBe(clips[0].text);
        expect(clips[2].text).not.toBe(clips[1].text);
        if (source.id === 'reference') expect(clips.every(clip => clip.take === 0 && clip.speakerConsistencyVerified === false)).toBe(true);
        if (round === 1) observations.push({ source: source.id, language, profiles: clips.map(clip => clip.voiceId), paths });
        // The score follows displayed feedback, never a fixed answer quota.
        await answerA.click();
        await expect(page.locator('.answer-feedback')).toBeVisible();
        if ((await page.locator('.answer-feedback strong').textContent()) === 'You heard the shared feature.') observedCorrect += 1;
        if (fullSession) {
          media.length = 0;
          await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click();
        }
      }
      if (fullSession) {
        await expect(page.locator('.save-note')).toHaveText('Session saved on this device.');
        await expect(page.getByRole('region', { name: 'Your next listening suggestion' })).toHaveCount(0);
        await expect(page.locator('.session-complete a[href^="/practice?"]')).toHaveCount(0);
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.progress.v1')));
        expect(saved.sessions).toHaveLength(1);
        expect(saved.sessions[0]).toMatchObject({ mode: 'abx-cross-word', schemaVersion: 2, audioCollectionId: 'comparison-fixed-reference-v1', languageId: 'fr', contrastId: 'fr-u-y', textHintsUsed: false, correct: observedCorrect, total: 12 });
        await page.getByRole('link', { name: 'View your history', exact: true }).click();
        const row = page.locator('.history-row');
        const revisit = page.locator('.history-description a');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('Audio comparison: Reference-conditioned candidate');
        await expect(revisit).toHaveAttribute('href', '/audio-comparison?language=fr&contrast=fr-u-y&source=reference');
        await page.reload();
        await expect(row).toContainText('Audio comparison: Reference-conditioned candidate');
        await expect(revisit).toHaveAttribute('href', '/audio-comparison?language=fr&contrast=fr-u-y&source=reference');
        await revisit.click();
        await expect(page).toHaveURL(/\/audio-comparison\/?\?language=fr&contrast=fr-u-y&source=reference$/);
        await expect(page.getByLabel('I’m learning')).toHaveValue('fr');
        await expect(page.getByRole('button', { name: /Reference-conditioned candidate/ })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
        await expect(page.getByRole('checkbox', { name: 'Show text hints' })).not.toBeChecked();
      }
    }
    await page.reload();
    if (await page.getByRole('button', { name: 'Keep analytics off', exact: true }).isVisible()) await page.getByRole('button', { name: 'Keep analytics off', exact: true }).click();
    await expect(page.getByRole('button', { name: /Reference-conditioned candidate/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('I’m learning')).toHaveValue(language);
    await expect(page.locator('.comparison-source-detail')).toContainText('not a listening-verified guarantee');
    expect(errors).toEqual([]);
    await testInfo.attach('comparison-source-playback', { body: JSON.stringify({ observations, phoneticListeningVerified: false }, null, 2), contentType: 'application/json' });
    await cdp.detach();
  });
}

test('comparison credits retain every human license and the original additional notice', async ({ page }) => {
  await page.goto('/audio-credits');
  await keepAnalyticsOff(page);
  await expect(page.locator('#french-recordings article')).toHaveCount(12);
  await expect(page.locator('#english-recordings article')).toHaveCount(24);
  const fill = page.locator('#english-recordings article').filter({ has: page.getByRole('heading', { name: 'fill · Dvortygirl', exact: true }) });
  await expect(fill).toContainText('Betsy Megas');
  await expect(fill).toContainText('Creative Commons BY-CA');
  await expect(fill.getByRole('link', { name: 'CC-BY-SA-3.0', exact: true })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/3.0/');
  await expect(fill.getByRole('link', { name: 'Audited source revision' })).toHaveAttribute('href', /oldid=1229132638/);
  await expect(page.locator('#generated-recordings')).toContainText('not approved to replace the default audio');
});
