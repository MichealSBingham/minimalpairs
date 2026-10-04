import { useEffect, useState } from 'react';
import Trainer from './Trainer';
import type { Language } from './ui';
import { comparisonSources } from '../lib/audio-comparison';

export default function AudioComparison({ languages }: { languages: Language[] }) {
  const [sourceId, setSourceId] = useState<string>('generated');
  const source = comparisonSources.find(item => item.id === sourceId) || comparisonSources[0];
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('source');
    if (comparisonSources.some(item => item.id === requested)) setSourceId(requested!);
  }, []);
  function chooseSource(id: string) {
    setSourceId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('source', id);
    window.history.replaceState(null, '', url);
  }
  const controls = <section className="audio-comparison-panel" aria-label="Audio source comparison">
    <div className="comparison-heading"><div><span className="eyebrow">OPTIONAL AUDIO LAB</span><h2>Same listening task. Three audio sources.</h2><p>French or English. Three shared word pairs per language. Compare the recordings with the same audio-only ABX exercise.</p></div><span className="comparison-status">Experimental · listening review pending</span></div>
    <div className="comparison-source-options" aria-label="Choose an audio source">{comparisonSources.map(item => <button type="button" key={item.id} className={item.id === source.id ? 'is-selected' : ''} aria-pressed={item.id === source.id} onClick={() => chooseSource(item.id)}><span className="comparison-source-kind">{item.kind}</span><strong>{item.name}</strong><span>{item.description}</span></button>)}</div>
    <div className="comparison-source-detail" aria-live="polite"><p><strong>{source.name}.</strong> {source.detail}</p><a href={source.id === 'human' ? '/audio-credits#human-recordings' : '/audio-credits#generated-recordings'}>Sources and recording credits →</a></div>
    <p className="comparison-footnote">Changing source starts a fresh session. Sources stay separate, with no substitute audio. These candidates are not approved as the new default, and practice scores do not establish which source teaches better.</p>
  </section>;
  return <Trainer key={source.id} languages={languages} initialLanguage="fr" audioManifestPath={source.manifestPath} audioCollectionId={source.collectionId} headerContent={controls} />;
}
