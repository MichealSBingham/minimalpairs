import { test, expect } from '@playwright/test';
import { keepAnalyticsOff } from './analytics-choice.mjs';

// Each Playwright test receives a fresh, credential-free browser context.
// Playback uses the real MP3s and browser media events. We never mock audio,
// dispatch ended events, alter speed, edit application state or seed history.
// A passing test establishes playback behavior, not pronunciation correctness.
test.use({ storageState: { cookies: [], origins: [] } });

test('human pilot retains its scope, real playback gates, credits and guest-history source', async ({ page, context }, testInfo) => {
  const allowedWords = ['tout', 'tu', 'vous', 'vu', 'roue', 'rue'];
  const pilotRequests = [];
  const defaultRequests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  context.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/audio/human-fr-u-y/clips/')) pilotRequests.push(path);
    if (path.startsWith('/audio/clips/') || path === '/audio/manifest.json') defaultRequests.push(path);
  });

  const manifestResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/audio/human-library.json');
  await page.goto('/human-audio-preview');
  await keepAnalyticsOff(page);
  const response = await manifestResponse;
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(Object.keys(manifest.voicesByLanguage)).toEqual(['fr', 'en', 'de']);
  expect(manifest.voicesByLanguage.fr).toHaveLength(2);
  expect(manifest.eligibleContrasts.filter(scope => scope.languageId === 'fr')).toEqual([expect.objectContaining({
    languageId: 'fr', contrastId: 'fr-u-y',
    pairIds: ['fr-tout-tu', 'fr-vous-vu', 'fr-roue-rue'],
    completeForListedPairs: true, completeForEntireContrast: false,
  })]);
  expect(manifest.clips).toHaveLength(44);
  for (const voice of manifest.voicesByLanguage.fr) {
    expect(manifest.clips.filter(clip => clip.voiceId === voice.id).map(clip => clip.text).sort()).toEqual([...allowedWords].sort());
  }
  for (const clip of manifest.clips.filter(clip => clip.languageId === 'fr')) {
    expect(clip).toMatchObject({ languageId: 'fr', synthetic: false, status: 'source-verified-unreviewed', phoneticListeningVerified: false });
    expect(clip.url).toMatch(/^\/audio\/human-fr-u-y\/clips\/[^/]+\.mp3$/);
  }

  await expect(page.getByRole('heading', { name: 'Train your ear.' })).toBeVisible();
  await expect(page.locator('.pilot-notice')).toContainText('Human recordings · French, English and German. Pronunciation and voice consistency are under review.');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByLabel('I’m learning')).toHaveValue('fr');
  await expect(page.locator('#practice-language option')).toHaveCount(3);
  await expect(page.locator('#practice-language option')).toHaveText(['French', 'English', 'German']);
  await expect(page.locator('.contrast-option')).toHaveCount(1);
  await expect(page.locator('.voice-setting')).toContainText('Human recordings · listening review in progress');
  await expect(page.locator('.trainer-card h2')).toHaveText('Sound contrast 01');
  expect(await page.evaluate(() => localStorage.getItem('minimalpairs.progress.v1'))).toBeNull();

  await page.getByRole('link', { name: 'Recording credits' }).click();
  await expect(page).toHaveURL(/\/audio-credits\/?$/);
  await expect(page.getByRole('heading', { name: 'Audio credits.' })).toBeVisible();
  await expect(page.locator('#french-recordings .credit-list article')).toHaveCount(12);
  for (const word of allowedWords) {
    for (const author of ['Sartus85', 'Poslovitch']) {
      const article = page.locator('.credit-list article').filter({ has: page.getByRole('heading', { name: `${word} · ${author}`, exact: true }) });
      await expect(article).toHaveCount(1);
      await expect(article.getByRole('link', { name: `File:LL-Q150 (fra)-${author}-${word}.wav`, exact: true })).toHaveAttribute('href', `https://commons.wikimedia.org/wiki/File:LL-Q150_(fra)-${author}-${word}.wav`);
      await expect(article.getByRole('link', { name: author === 'Sartus85' ? 'CC-BY-SA-4.0' : 'CC0-1.0', exact: true })).toHaveAttribute('href', author === 'Sartus85' ? 'https://creativecommons.org/licenses/by-sa/4.0/' : 'https://creativecommons.org/publicdomain/zero/1.0/');
      await expect(article.getByRole('link', { name: 'Audited source revision' })).toHaveAttribute('href', /commons\.wikimedia\.org\/w\/index\.php\?.*oldid=/);
    }
  }
  await expect(page.locator('#french-recordings .editorial-panel')).toContainText('converted to 192 kbps MP3');
  await expect(page.locator('#french-recordings .editorial-panel')).toContainText('does not imply their endorsement');
  await page.getByRole('link', { name: 'Try the human-audio comparison' }).click();
  await expect(page).toHaveURL(/\/human-audio-preview\/?$/);

  const hints = page.getByRole('checkbox', { name: 'Show text hints' });
  const answerA = page.locator('.abx-answer-options .answer-card').nth(0);
  const answerB = page.locator('.abx-answer-options .answer-card').nth(1);
  await expect(hints).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  let observedCorrect = 0;
  const feedback = [];
  for (let round = 1; round <= 12; round++) {
    await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
    await expect(answerA).toBeDisabled();
    await expect(answerB).toBeDisabled();
    await expect(page.locator('.answer-feedback')).toHaveCount(0);
    await expect(page.locator('.abx-word-hint')).toHaveCount(0);
    await expect(page.locator('.trainer-card h2')).toHaveText('Sound contrast 01');
    await expect(answerA).toBeEnabled();
    await expect(answerB).toBeEnabled();
    await expect(page.locator('.abx-heard-mark')).toHaveCount(3);

    if (round === 1) {
      // A user-requested replay also gates answers until real media completion.
      await page.getByRole('button', { name: 'Play X, test word', exact: true }).click();
      await expect(answerA).toBeDisabled();
      await expect(answerB).toBeDisabled();
      await expect(answerA).toBeEnabled();
      await expect(answerB).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath('human-pilot-audio-only.png'), fullPage: true });
    }
    if (round === 3) {
      await page.locator('.toggle-label').click();
      await expect(hints).toBeChecked();
      await expect(page.locator('.abx-word-hint')).toHaveCount(3);
      for (const word of await page.locator('.abx-word-hint strong').allTextContents()) expect(allowedWords).toContain(word);
      await page.locator('.toggle-label').click();
      await expect(hints).not.toBeChecked();
      await expect(page.locator('.abx-word-hint')).toHaveCount(0);
    }

    // Score is derived from visible feedback. Randomization/revisits need not
    // produce an exact score, and the test never reads a hidden answer key.
    await (round % 3 === 0 ? answerB : answerA).click();
    const result = page.locator('.answer-feedback');
    await expect(result).toBeVisible();
    const resultText = (await result.locator('strong').innerText()).trim();
    feedback.push(resultText);
    if (resultText === 'You heard the shared feature.') observedCorrect += 1;
    else expect(resultText).toMatch(/^X shares [AB]’s target feature\.$/);
    await expect(answerA).toBeDisabled();
    await expect(answerB).toBeDisabled();
    await expect(page.locator('.abx-word-hint')).toHaveCount(0);
    await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click();
  }

  await expect(page.getByRole('heading', { name: 'You made time to listen.' })).toBeVisible();
  await expect(page.locator('.session-results > div').first().locator('strong')).toHaveText(`${observedCorrect}/12`);
  await expect(page.locator('.save-note')).toHaveText('Session saved on this device.');
  await expect(page.locator('.score-note')).toContainText('Text hints were used in this session.');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.progress.v1')));
  expect(saved.sessions).toHaveLength(1);
  expect(saved.sessions[0]).toMatchObject({ mode: 'abx-cross-word', schemaVersion: 2, audioCollectionId: 'human-library-v1', textHintsUsed: true, languageId: 'fr', contrastId: 'fr-u-y', correct: observedCorrect, total: 12 });
  expect(saved.sessions[0].mistakes).toHaveLength(12 - observedCorrect);
  for (const mistake of saved.sessions[0].mistakes) {
    expect(['fr-tout-tu', 'fr-vous-vu', 'fr-roue-rue']).toContain(mistake.pairId);
    expect(allowedWords).toContain(mistake.word);
    expect(allowedWords).toContain(mistake.chosenWord);
  }
  expect(pilotRequests.length).toBeGreaterThan(0);
  expect(defaultRequests).toEqual([]);

  await page.getByRole('link', { name: 'View your history' }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-row')).toContainText('Human recordings');
  await expect(page.locator('.history-row')).toContainText('Text hints used');
  await expect(page.locator('.history-score strong')).toHaveText(`${observedCorrect}/12`);
  await expect(page.locator('.history-description a')).toHaveAttribute('href', '/human-audio-preview?language=fr&contrast=fr-u-y');
  await page.reload();
  await expect(page.locator('.history-description a')).toHaveAttribute('href', '/human-audio-preview?language=fr&contrast=fr-u-y');
  await page.locator('.history-description a').click();
  await expect(page).toHaveURL(/\/human-audio-preview\/?\?language=fr&contrast=fr-u-y$/);
  await expect(page.locator('.voice-setting')).toContainText('Human recordings · listening review in progress');
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
  await expect(hints).not.toBeChecked();
  await expect(page.locator('.contrast-option')).toHaveCount(1);
  expect(defaultRequests).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach('human-pilot-session', {
    body: JSON.stringify({ observedCorrect, feedback, realAudioRequests: pilotRequests.length, defaultAudioRequests: defaultRequests, session: saved.sessions[0], phoneticListeningVerified: false }, null, 2),
    contentType: 'application/json',
  });
});
