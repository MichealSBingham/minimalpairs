import { test } from 'node:test';
import assert from 'node:assert/strict';

const DEFAULT = '/audio/manifest.json';
const HUMAN = '/audio/human-fr-u-y/manifest.json';
let moduleSequence = 0;
const empty = () => ({ voicesByLanguage: {}, clips: [] });
function collection({ voice = 'human-one', synthetic = false, status = 'source-verified-unreviewed', url = '/audio/human-fr-u-y/clips/tout.mp3' } = {}) {
  return { voicesByLanguage: { fr: [{ id: voice, name: voice }] }, clips: [{ languageId: 'fr', text: 'tout', voiceId: voice, url, synthetic, status }] };
}

async function setup(t, routes = {}, brokenAudio = []) {
  const originals = new Map(['fetch', 'window', 'Audio', 'speechSynthesis', 'SpeechSynthesisUtterance'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const calls = { fetch: [], audio: [], speak: [], deviceVoiceQueries: 0 };
  const speechSynthesis = {
    getVoices() { calls.deviceVoiceQueries++; return [{ voiceURI: 'local-fr', name: 'Device French', lang: 'fr-FR' }]; },
    addEventListener() {}, removeEventListener() {}, cancel() {},
    speak(utterance) { calls.speak.push(utterance.text); queueMicrotask(() => utterance.onend?.()); },
  };
  Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, writable: true, value: speechSynthesis });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { speechSynthesis, setTimeout } });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: class { constructor(text) { this.text = text; } } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async path => {
    calls.fetch.push(path);
    const response = typeof routes[path] === 'function' ? routes[path]() : routes[path];
    if (response instanceof Error) throw response;
    return { ok: response !== undefined, json: async () => structuredClone(response) };
  } });
  Object.defineProperty(globalThis, 'Audio', { configurable: true, writable: true, value: class {
    constructor(url) { this.url = url; calls.audio.push(url); }
    pause() {}
    play() { queueMicrotask(() => brokenAudio.includes(this.url) ? this.onerror?.() : this.onended?.()); return Promise.resolve(); }
  } });
  t.after(() => {
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  });
  const audio = await import(`../src/lib/audio.ts?source-test=${++moduleSequence}`);
  return { audio, calls };
}

test('audio sources: custom human recordings use only their requested manifest and voice', async t => {
  const { audio, calls } = await setup(t, { [HUMAN]: collection(), [DEFAULT]: collection({ voice: 'qwen-one', synthetic: true, url: '/audio/clips/generated.mp3' }) });
  assert.deepEqual((await audio.getVoices('fr', HUMAN)).map(v => v.id), ['human-one']);
  await audio.playWord('fr', { text: ' TOUT ' }, 'human-one', HUMAN);
  assert.deepEqual(calls.fetch, [HUMAN]);
  assert.deepEqual(calls.audio, ['/audio/human-fr-u-y/clips/tout.mp3']);
  assert.deepEqual(calls.speak, []);
  assert.equal(calls.deviceVoiceQueries, 0);
});

test('audio sources: missing human word or requested voice errors without synthesis or default-cache substitution', async t => {
  const { audio, calls } = await setup(t, { [HUMAN]: collection(), [DEFAULT]: collection({ voice: 'qwen-one', synthetic: true }) });
  for (const [word, voice] of [['bu', 'human-one'], ['tout', 'missing-voice'], ['tout', 'device:local-fr'], ['bu', undefined]]) {
    await assert.rejects(audio.playWord('fr', word, voice, HUMAN), /not available in this audio collection/);
  }
  assert.deepEqual(calls.fetch, [HUMAN]);
  assert.deepEqual(calls.audio, []);
  assert.deepEqual(calls.speak, []);
  assert.equal(calls.deviceVoiceQueries, 0);
});

test('audio sources: missing or failed custom manifests stay unavailable despite installed device voices', async t => {
  const { audio, calls } = await setup(t, { '/audio/offline.json': new Error('offline') });
  for (const path of [HUMAN, '/audio/offline.json']) {
    assert.deepEqual(await audio.getVoices('fr', path), []);
    assert.equal((await audio.getAudioStatus('fr', path)).mode, 'unavailable');
    await assert.rejects(audio.playWord('fr', 'tout', undefined, path), /not available/);
  }
  assert.equal(calls.deviceVoiceQueries, 0);
  assert.deepEqual(calls.speak, []);
});

test('audio sources: rejected human clips cannot become selectable or playable', async t => {
  const { audio, calls } = await setup(t, { [HUMAN]: collection({ status: 'rejected' }) });
  assert.deepEqual(await audio.getVoices('fr', HUMAN), []);
  await assert.rejects(audio.playWord('fr', 'tout', 'human-one', HUMAN), /not available/);
  assert.deepEqual(calls.audio, []);
  assert.deepEqual(calls.speak, []);
});

test('audio sources: a failed human media file reports failure without substituting another source', async t => {
  const url = '/audio/human-fr-u-y/clips/broken.mp3';
  const { audio, calls } = await setup(t, { [HUMAN]: collection({ url }) }, [url]);
  await assert.rejects(audio.playWord('fr', 'tout', 'human-one', HUMAN), /could not load/);
  assert.deepEqual(calls.speak, []);
  assert.equal(calls.deviceVoiceQueries, 0);
});

for (const synthetic of [false, true]) {
  for (const status of ['verified', 'source-verified-unreviewed']) {
    test(`audio sources: label identifies ${synthetic ? 'generated' : 'human'} and ${status === 'verified' ? 'reviewed' : 'unreviewed'} material`, async t => {
      const { audio } = await setup(t, { [HUMAN]: collection({ synthetic, status }) });
      const result = await audio.getAudioStatus('fr', HUMAN);
      assert.equal(result.mode, 'cached');
      assert.match(result.label, /Audio recordings/);
      if (status === 'verified') {
        assert.match(result.label, /reviewed/i);
        assert.doesNotMatch(result.label, /in progress|unreviewed/i);
      } else assert.match(result.label, /in progress|unreviewed/i);
    });
  }
}

test('audio sources: default cache API remains compatible and is cached separately from human pilot', async t => {
  const generated = collection({ voice: 'qwen-one', synthetic: true, status: 'generated-unreviewed', url: '/audio/clips/default.mp3' });
  const { audio, calls } = await setup(t, { ['/audio/chatterbox-fr/manifest.json']: generated, [HUMAN]: collection() });
  assert.equal((await audio.getVoices('fr'))[0].id, 'qwen-one');
  await audio.getVoices('fr', HUMAN);
  await audio.getVoices('fr');
  await audio.playWord('fr', 'tout', 'qwen-one');
  assert.deepEqual(calls.fetch, ['/audio/chatterbox-fr/manifest.json', HUMAN]);
  assert.deepEqual(calls.audio, ['/audio/clips/default.mp3']);
  assert.deepEqual(calls.speak, []);
  await assert.rejects(audio.playWord('fr', 'tout', 'unknown-cached-voice'), /does not yet have a recording/);
});

test('audio sources: default collection retains its explicitly labeled device-preview fallback', async t => {
  const { audio, calls } = await setup(t, { [DEFAULT]: empty() });
  assert.equal((await audio.getVoices('fr'))[0].id, 'device:local-fr');
  assert.equal((await audio.getAudioStatus('fr')).mode, 'device');
  await audio.playWord('fr', 'tout', 'device:local-fr');
  assert.deepEqual(calls.speak, ['tout']);
  assert.deepEqual(calls.audio, []);
});

test('audio sources: external manifest URLs are rejected before fetching', async t => {
  const { audio, calls } = await setup(t);
  await assert.rejects(audio.getVoices('fr', 'https://example.invalid/audio.json'), /Invalid audio collection/);
  assert.deepEqual(calls.fetch, []);
});

function coverageCollection() {
  const voices = ['complete', 'partial', 'rejected', 'other-language'];
  const clips = [];
  for (const voice of voices) {
    for (const text of voice === 'partial' ? ['tout', 'tu'] : ['tout', 'tu', 'vous', 'vu']) clips.push({
      languageId: voice === 'other-language' ? 'de' : 'fr', text, voiceId: voice,
      url: `/audio/clips/${voice}-${text}.mp3`, synthetic: false,
      status: voice === 'rejected' && text === 'vu' ? 'rejected' : 'verified',
    });
  }
  return { voicesByLanguage: { fr: voices.map(id => ({ id, name: id })) }, clips };
}

test('audio coverage: only a profile with every contrast word is eligible, scoped to language and accepted clips', async t => {
  const { audio, calls } = await setup(t, { [HUMAN]: coverageCollection() });
  const required = ['tout', 'tu', 'vous', 'vu'];
  assert.deepEqual((await audio.getVoices('fr', HUMAN, required)).map(v => v.id), ['complete']);
  const status = await audio.getAudioStatus('fr', HUMAN, required);
  assert.equal(status.mode, 'cached');
  assert.match(status.label, /Audio recordings · listening reviewed · one voice profile/);
  assert.equal(calls.deviceVoiceQueries, 0);
  for (const word of required) await audio.playWord('fr', word, 'complete', HUMAN);
  assert.equal(calls.audio.length, required.length);
  assert.deepEqual(calls.speak, []);
});

test('audio coverage: selection changes recompute complete profiles even with the same cached manifest', async t => {
  const { audio, calls } = await setup(t, { [HUMAN]: coverageCollection() });
  assert.deepEqual((await audio.getVoices('fr', HUMAN, ['tout', 'tu'])).map(v => v.id), ['complete', 'partial', 'rejected']);
  assert.deepEqual((await audio.getVoices('fr', HUMAN, ['vous', 'vu'])).map(v => v.id), ['complete']);
  assert.deepEqual(await audio.getVoices('fr', HUMAN, ['tout', 'absent']), []);
  assert.deepEqual(calls.fetch, [HUMAN]);
});

test('audio coverage: a custom collection with partial coverage cannot fall back or claim cached availability', async t => {
  const { audio, calls } = await setup(t, { [HUMAN]: collection(), [DEFAULT]: collection({ synthetic: true }) });
  assert.deepEqual(await audio.getVoices('fr', HUMAN, ['tout', 'tu']), []);
  assert.deepEqual(await audio.getAudioStatus('fr', HUMAN, ['tout', 'tu']), { mode: 'unavailable', label: 'No complete audio voice is available for this sound contrast.' });
  assert.deepEqual(calls.fetch, [HUMAN]);
  assert.equal(calls.deviceVoiceQueries, 0);
});

test('audio coverage: default partial cache uses only explicitly selected device preview, never mixed cached words', async t => {
  const { audio, calls } = await setup(t, { [DEFAULT]: collection({ voice: 'generated-partial', synthetic: true }) });
  const required = ['tout', 'tu'];
  const voices = await audio.getVoices('fr', DEFAULT, required);
  assert.deepEqual(voices.map(v => v.id), ['device:local-fr']);
  assert.equal((await audio.getAudioStatus('fr', DEFAULT, required)).mode, 'device');
  for (const word of required) await audio.playWord('fr', word, voices[0].id);
  assert.deepEqual(calls.audio, []);
  assert.deepEqual(calls.speak, required);
});

test('audio coverage: normalization matches playback and missing URLs cannot count as coverage', async t => {
  const data = collection();
  data.clips[0].text = ' e\u0301te\u0301 ';
  const { audio } = await setup(t, { [HUMAN]: data, '/audio/empty-url.json': { ...data, clips: [{ ...data.clips[0], url: '' }] } });
  assert.deepEqual((await audio.getVoices('fr', HUMAN, ['ÉTÉ', 'été'])).map(v => v.id), ['human-one']);
  assert.deepEqual(await audio.getVoices('fr', '/audio/empty-url.json', ['été']), []);
});

test('audio coverage: source and review labels use only selected words and eligible profiles', async t => {
  const data = coverageCollection();
  data.clips.push({ languageId: 'fr', text: 'unrelated', voiceId: 'complete', url: '/audio/other.mp3', synthetic: true, status: 'generated-unreviewed' });
  const { audio } = await setup(t, { [HUMAN]: data });
  const status = await audio.getAudioStatus('fr', HUMAN, ['tout', 'tu', 'vous', 'vu']);
  assert.match(status.label, /Audio recordings · listening reviewed/);
  assert.doesNotMatch(status.label, /Generated|in progress/);
});

 test('a replaced media URL reloads its manifest once and keeps the requested voice',async t=>{
 let n=0;const old='/audio/human-fr-u-y/clips/old.mp3', fresh='/audio/human-fr-u-y/clips/new.mp3';
 const {audio,calls}=await setup(t,{[HUMAN]:()=>collection({url:++n===1?old:fresh})},[old]);
 await audio.playWord('fr','tout','human-one',HUMAN);
 assert.deepEqual(calls.audio,[old,fresh]);assert.equal(calls.fetch.length,2);assert.deepEqual(calls.speak,[]);
 });
