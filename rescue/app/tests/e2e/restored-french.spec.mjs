import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { keepAnalyticsOff } from './analytics-choice.mjs';

const curriculum = JSON.parse(readFileSync(new URL('../../../content/curriculum.json', import.meta.url), 'utf8'));
const french = (Array.isArray(curriculum) ? curriculum : curriculum.languages).find(language => language.id === 'fr');
const normalize = word => word.normalize('NFC').trim().toLowerCase();
const restoredIds = ['fr-o-u', 'fr-o-on'];

for (const contrastId of restoredIds) {
  test(`${contrastId}: restored guide opens cached cross-word ABX with correct recording and feedback mapping`, async ({ page, context }, testInfo) => {
    const contrast = french.contrasts.find(item => item.id === contrastId);
    expect(contrast, 'The restored contrast must exist in the current curriculum').toBeTruthy();
    expect(contrast.pairs).toHaveLength(3);
    const entryByWord = new Map(contrast.pairs.flatMap(pair => pair.words.map((word, category) => [normalize(word.text), { pair, word, category }])));
    const practicePath = `/practice?language=fr&contrast=${contrastId}`;
    const manifestPath = '/audio/manifest.json';
    const requested = [], mediaFailures = [], pageErrors = [];

    // Only the network cache is disabled. The page uses real media, its normal
    // timing/ended events, and its own randomly generated exercise state.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (/^\/audio\/.*\.mp3$/.test(pathname)) requested.push(pathname);
    });
    page.on('response', response => {
      if (/^\/audio\/.*\.mp3$/.test(new URL(response.url()).pathname) && !response.ok()) {
        mediaFailures.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto(`/learn/${contrastId}`);
    await keepAnalyticsOff(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(contrast.label);
    await expect(page.locator('.ed-pair-row')).toHaveCount(3);
    await expect(page.locator('.ed-pair-words strong')).toHaveText(contrast.pairs.flatMap(pair => pair.words.map(word => word.text)));
    await expect(page.locator('.ed-practice-panel .ed-small')).toHaveText('Generated audio · listening review pending');
    await expect(page.locator('.ed-sources')).toContainText('Cached recordings cover every word in this contrast with 2 voice profiles.');
    await expect(page.locator('.ed-sources')).toContainText('Pronunciation listening review is still pending; this is preview material.');
    const startFromGuide = page.getByRole('link', { name: 'Practice this contrast', exact: true });
    await expect(startFromGuide).toHaveAttribute('href', practicePath);
    await expect(page.getByRole('link', { name: 'Open the exercise', exact: true })).toHaveAttribute('href', practicePath);
    const manifestResponse = page.waitForResponse(response => new URL(response.url()).pathname === manifestPath);
    await startFromGuide.click();
    await expect(page).toHaveURL(url => /^\/practice\/?$/.test(url.pathname) && url.searchParams.get('language') === 'fr' && url.searchParams.get('contrast') === contrastId);
    const manifest = await (await manifestResponse).json();
    const clipByPath = new Map(manifest.clips.map(clip => [new URL(clip.url, page.url()).pathname, clip]));
    const eligibleVoiceIds = manifest.voicesByLanguage.fr.filter(voice => [...entryByWord.keys()].every(word => manifest.clips.some(clip => clip.languageId === 'fr' && clip.voiceId === voice.id && clip.status !== 'rejected' && normalize(clip.text) === word))).map(voice => voice.id);
    expect(eligibleVoiceIds).toHaveLength(2);
    await expect(page.getByLabel('I’m learning')).toHaveValue('fr');
    await expect(page.locator('.voice-setting')).toContainText('Varied voice profiles');
    await expect(page.getByRole('checkbox', { name: 'Show text hints' })).not.toBeChecked();
    const start = page.getByRole('button', { name: 'Start with A, B & X' });
    await expect(start).toBeEnabled();
    const answerCards = page.locator('.abx-answer-options .answer-card');
    const rounds = [];
    requested.length = 0;
    await start.click();

    for (let round = 1; round <= 3; round++) {
      await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
      await expect(answerCards.first()).toBeDisabled();
      await expect(answerCards.first()).toBeEnabled();
      await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
      if (round === 1) {
        await expect(page.locator('.abx-word-hint')).toHaveCount(0);
        await page.locator('.toggle-label').click();
        await expect(page.getByRole('checkbox', { name: 'Show text hints' })).toBeChecked();
      }
      const words = (await page.locator('.abx-word-hint strong').allTextContents()).map(normalize);
      expect(words).toHaveLength(3);
      // A browser may repeat a range request. Collapse adjacent duplicates only;
      // this preserves the actual A, B, X request order without mocking audio.
      const paths = requested.filter((path, index) => index === 0 || path !== requested[index - 1]);
      expect(paths).toHaveLength(3);
      const clips = paths.map(path => clipByPath.get(path));
      expect(clips.every(Boolean)).toBe(true);
      expect(clips.map(clip => normalize(clip.text))).toEqual(words);
      expect(clips[0].voiceId).toBe(clips[1].voiceId);
      expect(clips[2].voiceId).not.toBe(clips[0].voiceId);
      for (const clip of clips) {
        expect(clip.languageId).toBe('fr');
        expect(eligibleVoiceIds).toContain(clip.voiceId);
        expect(clip.synthetic).toBe(true);
        expect(clip.status).toBe('generated-unreviewed');
      }
      const entries = words.map(word => entryByWord.get(word));
      expect(entries.every(Boolean)).toBe(true);
      expect(entries[0].pair.id).toBe(entries[1].pair.id);
      expect(entries[2].pair.id).not.toBe(entries[0].pair.id);
      expect(words[2]).not.toBe(words[0]);
      expect(words[2]).not.toBe(words[1]);
      expect(entries[0].category).not.toBe(entries[1].category);
      expect(new Set(entries.map(entry => entry.pair.abx.trialGroup)).size).toBe(1);
      expect(entries.every(entry => entry.pair.abx.targetPosition === 'final')).toBe(true);
      const expectedReference = entries[2].category === entries[0].category ? 0 : 1;
      // Exercise both the positive feedback and the correction, using only the
      // visible words and independently authored curriculum category mapping.
      const selectedReference = round === 2 ? 1 - expectedReference : expectedReference;
      await answerCards.nth(selectedReference).click();
      await expect(page.locator('.answer-feedback strong')).toHaveText(round === 2 ? `X shares ${expectedReference === 0 ? 'A' : 'B'}’s target feature.` : 'You heard the shared feature.');
      await expect(answerCards.nth(expectedReference)).toHaveClass(/is-correct/);
      if (round === 2) await expect(answerCards.nth(selectedReference)).toHaveClass(/is-incorrect/);
      rounds.push({ round, words, pairIds: entries.map(entry => entry.pair.id), categories: entries.map(entry => entry.category), profiles: clips.map(clip => clip.voiceId), assets: paths, expectedReference, selectedReference });
      if (round < 3) {
        requested.length = 0;
        await page.getByRole('button', { name: 'Next round', exact: true }).click();
      }
    }
    expect(pageErrors).toEqual([]);
    expect(mediaFailures).toEqual([]);
    await testInfo.attach('restored-french-recording-mapping', { body: JSON.stringify({ contrastId, guidePath: `/learn/${contrastId}`, practicePath, manifestPath, eligibleVoiceIds, rounds, phoneticListeningVerified: false, note: 'Browser playback and mapping checks do not certify synthetic pronunciation.' }, null, 2), contentType: 'application/json' });
    await cdp.detach();
  });
}
