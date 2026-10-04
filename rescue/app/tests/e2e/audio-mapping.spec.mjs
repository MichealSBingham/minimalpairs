import { test, expect } from '@playwright/test';
import { keepAnalyticsOff } from './analytics-choice.mjs';
import { readFileSync } from 'node:fs';

const curriculum = JSON.parse(readFileSync(new URL('../../../content/curriculum.json', import.meta.url), 'utf8'));
const french = (Array.isArray(curriculum) ? curriculum : curriculum.languages).find(language => language.id === 'fr');
const contrast = french.contrasts.find(item => item.id === 'fr-u-y');
const normalize = word => word.normalize('NFC').trim().toLowerCase();

for (const pilot of [false, true]) {
  test(`${pilot ? 'human' : 'generated'} A/B/X playback uses the displayed words and distinct eligible profiles`, async ({ page, context }, testInfo) => {
    // Disable only the network cache, so each actual media request is observable.
    // Media playback, speed, ended events and React state remain untouched.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const manifestPath = pilot ? '/audio/human-library.json' : '/audio/manifest.json';
    const manifestResponse = page.waitForResponse(response => new URL(response.url()).pathname === manifestPath);
    const requested = [];
    const wrongSource = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (/^\/audio\/.*\.mp3$/.test(path)) requested.push(path);
      if (pilot && (path === '/audio/manifest.json' || path.startsWith('/audio/clips/'))) wrongSource.push(path);
    });
    await page.goto(pilot ? '/human-audio-preview' : '/practice?language=fr&contrast=fr-u-y');
    await keepAnalyticsOff(page);
    const manifest = await (await manifestResponse).json();
    const clipByPath = new Map(manifest.clips.map(clip => [new URL(clip.url, page.url()).pathname, clip]));
    const eligiblePairs = pilot ? contrast.pairs.filter(pair => manifest.eligibleContrasts[0].pairIds.includes(pair.id)) : contrast.pairs;
    const categoryByWord = new Map(eligiblePairs.flatMap(pair => pair.words.map((word, category) => [normalize(word.text), category])));
    const requiredWords = [...categoryByWord.keys()];
    const eligibleVoiceIds = manifest.voicesByLanguage.fr.filter(voice => requiredWords.every(word => manifest.clips.some(clip => clip.languageId === 'fr' && clip.voiceId === voice.id && clip.status !== 'rejected' && normalize(clip.text) === word))).map(voice => voice.id);
    expect(eligibleVoiceIds.length).toBeGreaterThan(1);
    await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
    await page.locator('.toggle-label').click();
    await expect(page.getByRole('checkbox', { name: 'Show text hints' })).toBeChecked();
    const answerA = page.locator('.abx-answer-options .answer-card').nth(0);
    const rounds = [];
    requested.length = 0;
    await page.getByRole('button', { name: 'Start with A, B & X' }).click();
    for (let round = 1; round <= 3; round++) {
      await expect(answerA).toBeDisabled();
      await expect(answerA).toBeEnabled();
      await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
      const words = (await page.locator('.abx-word-hint strong').allTextContents()).map(normalize);
      expect(words).toHaveLength(3);
      // Browsers may issue a second range request for one file. Collapse only
      // adjacent duplicates; the three different words still require 3 assets.
      const paths = requested.filter((path, index) => index === 0 || path !== requested[index - 1]);
      expect(paths).toHaveLength(3);
      const clips = paths.map(path => clipByPath.get(path));
      expect(clips.every(Boolean)).toBe(true);
      expect(clips.map(clip => normalize(clip.text))).toEqual(words);
      expect(clips[0].voiceId).toBe(clips[1].voiceId);
      expect(clips[2].voiceId).not.toBe(clips[0].voiceId);
      for (const clip of clips) expect(eligibleVoiceIds).toContain(clip.voiceId);
      expect(words[2]).not.toBe(words[0]);
      expect(words[2]).not.toBe(words[1]);
      expect(categoryByWord.get(words[0])).not.toBe(categoryByWord.get(words[1]));
      const expectedReference = categoryByWord.get(words[2]) === categoryByWord.get(words[0]) ? 0 : 1;
      await page.locator('.abx-answer-options .answer-card').nth(expectedReference).click();
      await expect(page.locator('.answer-feedback strong')).toHaveText('You heard the shared feature.');
      rounds.push({ words, profiles: clips.map(clip => clip.voiceId), assets: paths });
      if (round < 3) { requested.length = 0; await page.getByRole('button', { name: 'Next round' }).click(); }
    }
    expect(wrongSource).toEqual([]);
    await testInfo.attach('actual-recording-mapping', { body: JSON.stringify({ manifestPath, eligibleVoiceIds, rounds, phoneticListeningVerified: false }, null, 2), contentType: 'application/json' });
    await cdp.detach();
  });
}

test('contrast switching during manifest loading cannot activate incomplete profiles', async ({ page }) => {
  // Only the manifest is reduced for this edge case; all media files remain real.
  const second = french.contrasts.find(item => item.id === 'fr-an-on');
  const secondWords = new Set(second.pairs.flatMap(pair => pair.words.map(word => normalize(word.text))));
  let release;
  const released = new Promise(resolve => { release = resolve; });
  await page.route('**/audio/manifest.json', async route => {
    const response = await route.fetch();
    const manifest = await response.json();
    manifest.clips = manifest.clips.filter(clip => !(clip.languageId === 'fr' && clip.voiceId === 'qwen-fr-b' && secondWords.has(normalize(clip.text))));
    await released;
    await route.fulfill({ response, json: manifest });
  });
  await page.goto('/practice?language=fr&contrast=fr-u-y', { waitUntil: 'domcontentloaded' });
  await keepAnalyticsOff(page);
  await expect(page.getByLabel('I’m learning')).toHaveValue('fr');
  await page.locator('.contrast-option').filter({ hasText: 'Sound contrast 02' }).click();
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeDisabled();
  release();
  await expect(page.locator('.voice-setting')).toContainText('Single voice profile');
  await expect(page.locator('.voice-setting')).toContainText('Cross-voice practice is not available for this contrast.');
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
  await page.locator('.contrast-option').filter({ hasText: 'Sound contrast 01' }).click();
  await expect(page.locator('.voice-setting')).toContainText('Varied voice profiles');
  await expect(page.locator('.voice-setting')).not.toContainText('Cross-voice practice is not available');
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
});
