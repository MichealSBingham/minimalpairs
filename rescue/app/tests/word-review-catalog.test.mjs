import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildWordReviewCatalog, getWordReviewCatalog } from '../src/lib/word-review-catalog.ts';
import { humanLibraryLanguages } from '../src/lib/human-library.ts';

const app = path.resolve(import.meta.dirname, '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(app, relative), 'utf8'));
const main = read('../content/curriculum.json').languages;
const preview = humanLibraryLanguages(main);
const catalog = getWordReviewCatalog();
const sources = value => (value || []).filter(item => typeof item === 'string' && item.startsWith('https://'));
const expectedGroups = [
  ...main.flatMap(language => language.contrasts.map(contrast => ({ scope: 'main', language, contrast }))),
  ...preview.flatMap(language => language.contrasts.filter(contrast => !main.some(item => item.id === language.id && item.contrasts.some(group => group.id === contrast.id))).map(contrast => ({ scope: 'preview', language, contrast }))),
];

test('current export contains exactly 48 main groups plus the unique two-pair German preview', () => {
  assert.equal(catalog.version, 1);
  assert.match(catalog.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(catalog.languages.length, 8);
  assert.equal(catalog.groups.filter(group => group.scope === 'main').length, 48);
  assert.equal(catalog.groups.filter(group => group.scope === 'main').flatMap(group => group.pairs).length, 144);
  assert.equal(catalog.groups.length, 49);
  assert.equal(catalog.groups.flatMap(group => group.pairs).length, 146);
  assert.deepEqual(catalog.groups.filter(group => group.scope === 'preview').map(group => ({ id: group.id, languageId: group.languageId, pairs: group.pairs.map(pair => pair.id) })), [
    { id: 'de-i-length-pronouns', languageId: 'de', pairs: ['de-in-ihn', 'de-im-ihm'] },
  ]);
  assert.deepEqual(catalog.groups.map(group => `${group.scope}:${group.languageId}:${group.id}`), expectedGroups.map(({ scope, language, contrast }) => `${scope}:${language.id}:${contrast.id}`));
  assert.equal(new Set(catalog.groups.map(group => group.key)).size, 49);
  assert.equal(new Set(catalog.groups.flatMap(group => group.pairs.map(pair => pair.key))).size, 146);
  // Isolated expansion artifacts exist locally, but have no route into this export.
  for (const id of ['en-foot-goose', 'en-thought-lot-gb', 'fr-a-an', 'fr-u-y-depth-final-v1', 'fr-u-y-depth-medial-v1']) {
    assert.ok(!catalog.groups.some(group => group.id === id), id);
  }
});

test('every word, IPA, meaning, romanization, phoneme and selected target is copied from its exact source', () => {
  for (const { scope, language, contrast } of expectedGroups) {
    const group = catalog.groups.find(item => item.scope === scope && item.languageId === language.id && item.id === contrast.id);
    assert.ok(group, contrast.id);
    assert.equal(group.languageName, language.name);
    assert.equal(group.label, contrast.label);
    assert.equal(group.description, contrast.description);
    assert.equal(group.focus, contrast.targetSoundFocus || contrast.abx?.targetSoundFocus || '');
    assert.deepEqual(group.categories, contrast.phonemes);
    assert.deepEqual(group.sources, sources(contrast.sources));
    assert.equal(group.pairs.length, contrast.pairs.length);
    for (let index = 0; index < contrast.pairs.length; index++) {
      const raw = contrast.pairs[index]; const pair = group.pairs[index];
      assert.equal(pair.id, raw.id);
      assert.deepEqual(pair.words, raw.words.map(word => ({
        text: word.text, ipa: word.ipa, meaning: word.meaning,
        ...(word.romanization ? { romanization: word.romanization } : {}),
        ...(word.phonemes ? { phonemes: word.phonemes } : {}),
      })), raw.id);
      assert.deepEqual(pair.target, typeof raw.abx?.targetTokenIndex === 'number' ? raw.words.map(word => word.phonemes?.[raw.abx.targetTokenIndex] || '') : [], raw.id);
      assert.equal(pair.position, raw.abx?.targetPosition || '');
      assert.equal(pair.trialGroup, raw.abx?.trialGroup || 'all');
      assert.equal(pair.kind, raw.kind);
      assert.equal(pair.note, raw.note || '');
      assert.deepEqual(pair.sources, sources(raw.sources));
    }
  }
});

function fixture() {
  return [{ id: 'en', name: 'English', nativeName: 'English', dialect: 'Language dialect', locale: 'en-US', tagline: '', contrasts: [{
    id: 'fixture', label: 'Fixture contrast', phonemes: ['a', 'b'], description: 'Compare the first sound.',
    dialect: 'Selected contrast dialect', dialectNote: 'Citation-form caveat.', targetSoundFocus: 'The first sound.',
    sources: ['https://example.invalid/group', '/private/reference.txt'],
    abx: { matchType: 'phoneme', categoryLabels: ['a', 'b'], requireSameTargetPosition: true },
    pairs: [{ id: 'pair', kind: 'minimal', note: 'Citation form.', sources: ['https://example.invalid/pair'],
      abx: { targetTokenIndex: 0, targetPosition: 'initial', trialGroup: 'all', categoryByWordIndex: [0, 1] },
      words: [{ text: 'one', ipa: '/a/', meaning: 'First', romanization: 'one', phonemes: ['a'] }, { text: 'two', ipa: '/b/', meaning: 'Second', phonemes: ['b'] }],
    }],
  }] }];
}
const build = languages => buildWordReviewCatalog(languages, []);

test('contrast dialect restrictions remain available to the reviewer', () => {
  for (const { language, contrast } of expectedGroups) {
    const group = catalog.groups.find(item => item.languageId === language.id && item.id === contrast.id);
    assert.equal(group.languageDialect, language.dialect);
    assert.equal(group.dialect, contrast.dialect || language.dialect);
    assert.equal(group.dialectNote, contrast.dialectNote || '');
    const visible = JSON.stringify(group);
    for (const restriction of [language.dialect, contrast.dialect, contrast.dialectNote].filter(Boolean)) {
      assert.ok(visible.includes(JSON.stringify(restriction).slice(1, -1)), `${contrast.id}: missing dialect restriction ${restriction}`);
    }
  }
});

test('pair and group findings attach only to the exact language, contrast and pair', () => {
  const input = fixture(); const other = structuredClone(input[0]); other.id = 'de';
  const findings = [
    { contrastId: 'fixture', severity: 'needs-review', message: 'Shared group', sources: [] },
    { languageId: 'en', contrastId: 'fixture', severity: 'needs-review', message: 'English group', sources: [] },
    { languageId: 'en', contrastId: 'fixture', pairId: 'pair', severity: 'correction', message: 'English pair', sources: [] },
    { languageId: 'de', contrastId: 'fixture', pairId: 'pair', severity: 'correction', message: 'German pair', sources: [] },
    { contrastId: 'absent', pairId: 'pair', severity: 'needs-review', message: 'Wrong contrast', sources: [] },
    { contrastId: 'fixture', pairId: 'absent', severity: 'needs-review', message: 'Wrong pair', sources: [] },
  ];
  const result = buildWordReviewCatalog([...input, other], [], findings);
  const english = result.groups.find(group => group.languageId === 'en');
  const german = result.groups.find(group => group.languageId === 'de');
  assert.deepEqual(english.findings.map(item => item.message), ['Shared group', 'English group']);
  assert.deepEqual(german.findings.map(item => item.message), ['Shared group']);
  assert.deepEqual(english.pairs[0].findings.map(item => item.message), ['English pair']);
  assert.deepEqual(german.pairs[0].findings.map(item => item.message), ['German pair']);
  assert.doesNotMatch(JSON.stringify(result), /Wrong contrast|Wrong pair/);
});

test('current audit findings are attached without leaking pair findings onto the group or another pair', () => {
  const findings = ['text-review-audit-fr.json', 'text-review-audit-en-de.json', 'text-review-audit-other.json']
    .filter(file => fs.existsSync(path.join(app, '../content', file)))
    .flatMap(file => { const report = read(`../content/${file}`); return (report.findings || []).map(finding => ({ ...finding, languageId: finding.languageId || report.languageId })); });
  for (const group of catalog.groups) {
    const relevant = findings.filter(finding => finding.contrastId === group.id && (!finding.languageId || finding.languageId === group.languageId));
    assert.deepEqual(group.findings.map(finding => finding.message), relevant.filter(finding => !finding.pairId).map(finding => finding.message));
    for (const pair of group.pairs) {
      assert.deepEqual(pair.findings.map(finding => finding.message), relevant.filter(finding => finding.pairId === pair.id).map(finding => finding.message));
    }
  }
});

test('linguistic and matching-rule changes invalidate both pair and group review identities', async t => {
  const baseline = build(fixture());
  const cases = [
    ['word text', language => { language.contrasts[0].pairs[0].words[0].text = 'different'; }],
    ['IPA', language => { language.contrasts[0].pairs[0].words[0].ipa = '/different/'; }],
    ['meaning', language => { language.contrasts[0].pairs[0].words[0].meaning = 'Different sense'; }],
    ['romanization', language => { language.contrasts[0].pairs[0].words[0].romanization = 'different'; }],
    ['phonemes', language => { language.contrasts[0].pairs[0].words[0].phonemes = ['x']; }],
    ['language dialect', language => { language.dialect = 'Different language dialect'; }],
    ['contrast dialect', language => { language.contrasts[0].dialect = 'Different selected dialect'; }],
    ['contrast dialect note', language => { language.contrasts[0].dialectNote = 'Different citation restriction'; }],
    ['category order', language => { language.contrasts[0].phonemes.reverse(); }],
    ['pair category mapping', language => { language.contrasts[0].pairs[0].abx.categoryByWordIndex.reverse(); }],
    ['target token', language => { language.contrasts[0].pairs[0].abx.targetTokenIndex = 1; }],
    ['target position', language => { language.contrasts[0].pairs[0].abx.targetPosition = 'final'; }],
    ['trial group', language => { language.contrasts[0].pairs[0].abx.trialGroup = 'different'; }],
    ['contrast matching rule', language => { language.contrasts[0].abx.requireSameTargetPosition = false; }],
  ];
  for (const [label, mutate] of cases) await t.test(label, () => {
    const input = fixture(); mutate(input[0]); const changed = build(input);
    assert.notEqual(changed.fingerprint, baseline.fingerprint);
    assert.notEqual(changed.groups[0].key, baseline.groups[0].key);
    assert.notEqual(changed.groups[0].pairs[0].key, baseline.groups[0].pairs[0].key);
  });
});

test('audio-validation status and unused media metadata do not stale textual reviews or leak into export', () => {
  const input = fixture(); const baseline = build(input);
  input[0].validation = { audio: 'reviewed', privateReferencePath: '/private/secret.wav' };
  const contrast = input[0].contrasts[0];
  contrast.validation = { audio: 'rejected' };
  contrast.audio = { url: '/audio/secret.mp3' };
  contrast.guide = { audioStatus: 'Unreviewed clip metadata' };
  contrast.pairs[0].validation = { audio: 'approved', text: 'unchanged' };
  contrast.pairs[0].privateReferencePath = '/private/assessment/secret.wav';
  contrast.pairs[0].words[0].audioUrl = '/audio/secret.mp3';
  contrast.pairs[0].words[0].privateWavPath = '/private/secret.wav';
  assert.deepEqual(build(input), baseline);
  for (const result of [catalog, build(input)]) {
    const text = JSON.stringify(result);
    assert.doesNotMatch(text, /\/audio\/|\/Users\/|\/private\/|privateReferencePath|privateWavPath|audioUrl|clipIds|voiceId|reserved-assessment/);
  }
});

test('builder and current reader are deterministic and leave authoritative inputs unchanged', () => {
  const input = fixture(); const before = structuredClone(input);
  const first = build(input); const second = build(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.deepEqual(getWordReviewCatalog(), catalog);
  // Reordering object properties is serialization noise, not a new review identity.
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  assert.deepEqual(build(reorder(input)), first);
});
