import { useEffect, useRef, type MouseEvent } from 'react';
import type { ReviewRecommendation } from '../lib/review-recommendation';
import { analyticsChoice, browserDeclinesAnalytics, openMeasuredRecommendation, trackMeasurement, watchAnalyticsChoice } from '../lib/measurement';
import { Icon } from './ui';

export default function ReviewSuggestion({ recommendation, compact = false }: { recommendation: ReviewRecommendation; compact?: boolean }) {
  const element = useRef<HTMLElement>(null);
  const recommendationId = useRef('');
  const shownId = useRef('');
  const data = { language_id: recommendation.languageId, contrast_id: recommendation.contrastId, audio_collection: 'qwen-starter-v1', recommendation_kind: recommendation.kind, recommendation_surface: compact ? 'completion' : 'history' };
  function recordShown() {
    if (shownId.current !== recommendationId.current && trackMeasurement('review_shown', { ...data, recommendation_id: recommendationId.current })) shownId.current = recommendationId.current;
  }
  useEffect(() => {
    recommendationId.current = crypto.randomUUID();
    let visible = false;
    const record = () => { if (visible) recordShown(); };
    const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5); record(); }, { threshold: 0.5 });
    if (element.current) observer.observe(element.current);
    const unwatch = watchAnalyticsChoice(() => {
      if (analyticsChoice() !== 'allowed' || browserDeclinesAnalytics()) { shownId.current = ''; recommendationId.current = crypto.randomUUID(); }
      else record();
    });
    return () => { observer.disconnect(); unwatch(); };
  }, [recommendation.languageId, recommendation.contrastId, recommendation.kind, compact]);
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    // Explicit interaction proves exposure even if less than half of the card
    // is on screen or the observer has not delivered its callback yet.
    recordShown();
    const sameTab = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    openMeasuredRecommendation({ ...data, recommendation_id: recommendationId.current }, sameTab);
  }
  return <section ref={element} className={`review-suggestion${compact ? ' is-compact' : ''}`} aria-label="Your next listening suggestion">
    <span className="eyebrow">A USEFUL NEXT LISTEN</span>
    <h3>{recommendation.title}</h3>
    <span className="review-sound-label">{recommendation.languageName} · {recommendation.soundLabel}</span>
    <p>{recommendation.reason}</p>
    <a className="button button-dark" href={recommendation.href} onClick={follow} onAuxClick={event => { if (event.button === 1) { recordShown(); openMeasuredRecommendation({ ...data, recommendation_id: recommendationId.current }, false); } }}>{recommendation.action}<Icon name="arrow" size={16} /></a>
    <details><summary>Why this suggestion?</summary><p>{recommendation.explanation}</p></details>
  </section>;
}
