import { test, expect } from '@playwright/test';
import { startPracticeFocusFixture } from './practice-focus-fixture-server.mjs';

let fixture;
test.beforeAll(async () => { fixture = await startPracticeFocusFixture(); });
test.afterAll(async () => { await fixture?.close(); });
const focus = {
  initial: 'Focus on the vowel at the beginning of each word.',
  medial: 'Focus on the vowel inside each word.',
  first: 'Listen to the first vowel in each word.',
  final: 'Focus on the vowel at the end of each word.',
};
async function assertBlind(page) {
  await expect(page.locator('.abx-word-hint')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/hidden-(initial|medial|first|final)|secret-|unrevealed meaning|Hidden \/u–y\/|unrevealed vocabulary/);
  expect(await page.locator('body').ariaSnapshot()).not.toMatch(/hidden-(initial|medial|first|final)|secret-|unrevealed meaning|Hidden \/u–y\/|unrevealed vocabulary/);
  const labels = await page.locator('[aria-label],[title],[alt]').evaluateAll(nodes => nodes.flatMap(node => ['aria-label', 'title', 'alt'].map(name => node.getAttribute(name) || '')).join('\n'));
  expect(labels).not.toMatch(/hidden-|secret-|unrevealed/);
}
async function open(page) {
  const externalRequests = [];
  await page.route('**/*', route => {
    if (!route.request().url().startsWith(fixture.origin)) { externalRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(fixture.origin);
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
  return externalRequests;
}

test('mixed vowel focus follows every reference group and stays blind through feedback and explicit hints', async ({ page }, testInfo) => {
  const external = await open(page);
  await expect(page.locator('.abx-focus-note')).toHaveText('Listen for the target sound; its position can change between rounds.');
  await expect(page.locator('.ready-listening-steps li')).toHaveCount(3);
  expect(await page.locator('body').innerText()).not.toMatch(/\bABX\b|cross-word|target feature|reference group/i);
  await assertBlind(page);
  await page.screenshot({ path: testInfo.outputPath('trainer-ready.png'), fullPage: true });
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  await expect(page.getByRole('heading', { name: 'Does X share A’s sound or B’s?' })).toBeVisible();
  await expect(page.locator('.live-accuracy')).toHaveText('—');
  await expect(page.locator('.live-score')).toHaveText('0 correct of 0 answered');
  await expect(page.locator('.round-trail li')).toHaveCount(12);
  const seen = new Set();
  for (let round = 1; round <= 12; round++) {
    const answers = page.locator('.abx-answer-options .answer-card');
    await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
    await expect(answers.nth(0)).toBeEnabled();
    const calls = await page.evaluate(() => window.focusFixture.calls.slice(-3));
    expect(calls).toHaveLength(3);
    const group = calls[0].word.match(/^hidden-(initial|medial|first|final)-/)[1]; seen.add(group);
    await expect(page.locator('.abx-focus-note')).toHaveText(focus[group]);
    expect(calls[0].voice).toBe(calls[1].voice); expect(calls[0].voice).not.toBe(calls[2].voice);
    expect(calls[2].word).not.toBe(calls[0].word); expect(calls[2].word).not.toBe(calls[1].word);
    expect(calls[2].word).toContain(`hidden-${group}-`);
    await assertBlind(page);
    await expect(page.getByRole('button', { name: 'Reveal these words' })).toHaveCount(0);
    if (round === 1) {
      const boxes = await Promise.all(['a', 'b', 'x'].map(sample => page.locator(`.abx-sample.is-${sample} .abx-sound-button`).boundingBox()));
      expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1);
      if (testInfo.project.name === 'mobile') {
        expect(boxes[2].y).toBeGreaterThan(boxes[0].y + boxes[0].height);
        expect(boxes[2].width).toBeGreaterThan(boxes[0].width * 2);
      } else expect(Math.abs(boxes[0].y - boxes[2].y)).toBeLessThan(1);
      expect(await page.locator('.is-x .abx-sound-button').evaluate(node => getComputedStyle(node).borderTopStyle)).toBe('dashed');
      expect(await page.locator('.is-a .abx-sound-button').evaluate(node => getComputedStyle(node).borderTopColor)).toBe('rgb(36, 74, 124)');
      expect(await page.locator('.is-b .abx-sound-button').evaluate(node => getComputedStyle(node).borderTopColor)).toBe('rgb(182, 66, 41)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('trainer-active-blind.png'), fullPage: true });
    }
    if (round === 2 && testInfo.project.name === 'mobile') {
      await page.locator('.toggle-label').click();
      await expect(page.getByRole('checkbox', { name: 'Show text hints' })).toBeChecked();
      await expect(page.locator('.abx-word-hint')).toHaveCount(3);
      await expect(page.locator('.abx-word-hint').first()).toContainText(calls[0].word);
      await expect(page.locator('.abx-focus-note')).toHaveText(focus[group]);
      await page.locator('.toggle-label').click();
      await expect(page.getByRole('checkbox', { name: 'Show text hints' })).not.toBeChecked();
      await assertBlind(page);
    }
    const correct = calls[0].word.at(-1) === calls[2].word.at(-1) ? 0 : 1;
    // One intentional mistake exercises the real revisit scheduling path.
    await answers.nth(round === 1 ? 1 - correct : correct).click();
    await expect(page.locator('.answer-feedback')).toBeVisible();
    await assertBlind(page);
    await expect(page.locator('.live-score')).toHaveText(`${round - 1} correct of ${round} answered`);
    await expect(page.locator('.live-accuracy')).toHaveText(`${Math.round((round - 1) / round * 100)}%`);
    await expect(page.locator('.round-trail .is-correct')).toHaveCount(round - 1);
    await expect(page.locator('.round-trail .is-incorrect')).toHaveCount(1);
    if (round === 3) await page.screenshot({ path: testInfo.outputPath('mixed-vowel-focus.png'), fullPage: true });
    if (round === 3) {
      await page.getByRole('button', { name: 'Reveal these words' }).click();
      await expect(page.locator('.abx-word-hint')).toHaveCount(3);
      await expect(page.locator('.abx-word-hint').first()).toContainText(calls[0].word);
      await expect(page.getByRole('checkbox', { name: 'Show text hints' })).not.toBeChecked();
      await expect(page.locator('.live-score')).toHaveText('2 correct of 3 answered');
      await expect(page.getByRole('button', { name: 'Hide these words' })).toBeVisible();
    }
    await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click();
  }
  expect([...seen].sort()).toEqual(Object.keys(focus).sort());
  await expect(page.locator('.session-results')).toContainText('11/12');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.progress.v1')));
  expect(saved.sessions).toHaveLength(1);
  expect(saved.sessions[0]).toMatchObject({ total: 12, correct: 11, textHintsUsed: true, mode: 'abx-cross-word' });
  await expect(page.locator('.score-note')).toContainText('Words were shown during this session.');
  expect(external).toEqual([]);
});

test('focus text cannot bypass playback failure or answer unlocking', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.focusFixture.failNext = true; });
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  await expect(page.getByRole('alert')).toContainText('One of the sounds could not play');
  await expect(page.locator('.abx-focus-note')).toContainText('vowel');
  await expect(page.locator('.live-accuracy')).toHaveText('—');
  await expect(page.getByRole('button', { name: 'Reveal these words' })).toHaveCount(0);
  for (const answer of await page.locator('.answer-card').all()) await expect(answer).toBeDisabled();
  await assertBlind(page);
  await page.getByRole('button', { name: 'Replay A → B → X', exact: true }).click();
  for (const answer of await page.locator('.answer-card').all()) await expect(answer).toBeEnabled();
  await assertBlind(page);
});
