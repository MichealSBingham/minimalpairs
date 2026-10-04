import { commerce, commercePath } from '../lib/commerce-i18n';
import { useEffect, useRef, type MouseEvent } from 'react';
import type { ReviewRecommendation } from '../lib/review-recommendation';
import { analyticsChoice, browserDeclinesAnalytics, openMeasuredRecommendation, trackMeasurement, watchAnalyticsChoice } from '../lib/measurement';
import { Icon } from './ui';

export default function ReviewSuggestion({ recommendation, compact = false, locale = 'en' }: { recommendation: ReviewRecommendation; compact?: boolean; locale?: string }) {
  const t = commerce(locale);
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
  return <section ref={element} className={`review-suggestion${compact ? ' is-compact' : ''}`} aria-label={t('suggestion')}>
    <span className="eyebrow">{t('suggestion')}</span>
    <h3>{locale === 'en' ? recommendation.title : t('continue')}</h3>
    <span className="review-sound-label">{new Intl.DisplayNames([locale], { type: 'language' }).of(recommendation.languageId) || recommendation.languageName} · {recommendation.soundLabel.replace(/^Sound contrast /, `${t('startingSound')} `)}</span>
    <p>{locale === 'en' ? recommendation.reason : t('reviewReason')}</p>
    <a className="button button-dark" href={commercePath(locale, recommendation.href)} onClick={follow} onAuxClick={event => { if (event.button === 1) { recordShown(); openMeasuredRecommendation({ ...data, recommendation_id: recommendationId.current }, false); } }}>{locale === 'en' ? recommendation.action : t('practice')}<Icon name="arrow" size={16} /></a>
    <details><summary>{t('whySuggestion')}</summary><p>{locale === 'en' ? recommendation.explanation : t('reviewExplanation')}</p></details>
  </section>;
}
