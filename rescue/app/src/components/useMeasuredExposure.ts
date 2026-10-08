import { useEffect, useRef } from 'react';
import { trackMeasurement, watchAnalyticsChoice } from '../lib/measurement';
import type { EventData } from '../lib/measurement-data';

/** Measure a currently visible offer, once per exposure key, including late opt-in. */
export function useMeasuredExposure(node: HTMLElement | null, key: string, event: 'plans_view' | 'paywall_view', data: EventData) {
  const sent = useRef('');
  const exposure = useRef('');
  const latestData = useRef(data);
  latestData.current = data;
  useEffect(() => {
    if (exposure.current !== key) { exposure.current = key; sent.current = ''; }
    if (!key || !node) { sent.current = ''; return; }
    let visible = false;
    const record = () => {
      if (visible && document.visibilityState !== 'hidden' && sent.current !== key && trackMeasurement(event, latestData.current)) sent.current = key;
    };
    // No visibility inference when the browser cannot observe the element.
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.target === node && entry.isIntersecting && entry.intersectionRatio >= 0.5);
      record();
    }, { threshold: [0, 0.5] });
    observer.observe(node);
    const stop = watchAnalyticsChoice(record);
    document.addEventListener('visibilitychange', record);
    return () => { observer.disconnect(); stop(); document.removeEventListener('visibilitychange', record); };
  }, [node, key, event]);
}
