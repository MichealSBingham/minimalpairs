// Local-only Trainer host: real component and ABX engine, synthetic vocabulary and
// a stubbed audio boundary. This verifies rendering, not audio quality/playback.
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../../', import.meta.url));
const positions = ['initial', 'medial', 'first', 'final'];
const pairs = positions.flatMap(position => [1, 2].map(index => ({
  id: `${position}-${index}`, kind: 'minimal',
  words: ['a', 'b'].map(category => ({ text: `hidden-${position}-${index}-${category}`, ipa: `/secret-${position}-${index}-${category}/`, meaning: `unrevealed meaning ${position}-${index}-${category}` })),
  abx: { trialGroup: position, targetPosition: position === 'first' ? 'medial' : position, categoryByWordIndex: [0, 1] },
})));
const language = { id: 'fr', name: 'French', nativeName: 'Français', locale: 'fr-FR', dialect: 'Local UI fixture', tagline: '', contrasts: [{
  id: 'focus-fixture', label: 'Hidden /u–y/ label', phonemes: ['u', 'y'], description: 'An unrevealed vocabulary description.',
  targetSoundFocus: 'Listen for the target sound; its position can change between rounds.', pairs,
  abx: { requireSameTargetPosition: true, focusByTrialGroup: Object.fromEntries(positions.map(position => [position, { unit: 'vowel', position }])) },
}] };
const audioBoundary = `
window.focusFixture = { calls: [], failNext: false };
export async function getVoices(){return [{id:'fixture-a',name:'First fixture profile'},{id:'fixture-b',name:'Second fixture profile'}];}
export async function getAudioStatus(){return {mode:'cached',label:'Stubbed audio for UI testing'};}
export function stopAudio(){}
export async function playWord(language,word,voice){
  window.focusFixture.calls.push({word:word.text,voice});
  await new Promise(resolve=>setTimeout(resolve,40));
  if(window.focusFixture.failNext){window.focusFixture.failNext=false;throw Error('Intentional fixture playback rejection');}
}
`;

export async function startPracticeFocusFixture() {
  const result = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Trainer from './src/components/Trainer'; import './src/styles/global.css'; import './src/styles/product-redesign.css'; let seed=13; Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}; const language=${JSON.stringify(language)}; createRoot(document.getElementById('root')).render(<Trainer languages={[language]} initialLanguage="fr" initialContrast="focus-fixture" audioCollectionId="fixture-only"/>);`, resolveDir: app, loader: 'tsx' },
    bundle: true, write: false, outdir: '/fixture', format: 'esm', jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'local-audio-and-account-boundaries', setup(plugin) {
      plugin.onResolve({ filter: /(?:^|\/)audio$/ }, args => /src\/components\/Trainer\.tsx$/.test(args.importer) ? { path: 'audio', namespace: 'fixture' } : null);
      plugin.onResolve({ filter: /(?:^|\/)progress-sync$/ }, args => /src\/components\/Trainer\.tsx$/.test(args.importer) ? { path: 'progress-sync', namespace: 'fixture' } : null);
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'audio' ? audioBoundary : `export async function saveCompletedSession(){return 'disabled';}`, loader: 'js' }));
    } }],
  });
  const bundle = Object.fromEntries(result.outputFiles.map(file => [file.path.endsWith('.css') ? 'css' : 'js', file.text]));
  // Keep the local fixture self-contained; font-service access is unrelated to focus.
  bundle.css = bundle.css.split('\n').filter(line => !line.startsWith('@import') || !line.includes('fonts.googleapis.com')).join('\n');
  const server = createServer((request, response) => {
    if (request.url === '/fixture.js' || request.url === '/fixture.css') {
      const type = request.url.endsWith('.css') ? 'css' : 'js'; response.setHeader('Content-Type', type === 'css' ? 'text/css' : 'text/javascript'); response.end(bundle[type]); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
