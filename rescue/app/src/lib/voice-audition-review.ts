export type AuditionReview = { status: 'unreviewed' | 'pass' | 'fix' | 'unsure'; note: string; updatedAt: string };
export type AuditionReviews = Record<string, AuditionReview>;

/** Retain valid notes from other audition versions without displaying them as current reviews. */
export function parseAuditionReviews(raw: string | null): AuditionReviews {
  const value: unknown = JSON.parse(raw || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved reviews');
  return Object.fromEntries(Object.entries(value).filter(([id, r]) =>
    /^[a-zA-Z0-9_-]{1,200}:[a-f0-9]{64}$/.test(id) && r && typeof r === 'object'
    && ['unreviewed','pass','fix','unsure'].includes(r.status)
    && typeof r.note === 'string' && r.note.length <= 2000
    && typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt))));
}

export function mergeAuditionReviews(before: AuditionReviews, incoming: AuditionReviews): AuditionReviews {
  const merged = { ...before };
  for (const [id, review] of Object.entries(incoming)) {
    const previous = merged[id];
    if (!previous || Date.parse(review.updatedAt) > Date.parse(previous.updatedAt)
      || (review.updatedAt === previous.updatedAt && JSON.stringify(review) > JSON.stringify(previous))) merged[id] = review;
  }
  return merged;
}

export function serializeAuditionReviews(reviews: AuditionReviews) {
  return JSON.stringify(Object.fromEntries(Object.entries(reviews).sort(([a], [b]) => a.localeCompare(b))));
}

export function nextReviewTime(previous?: string) {
  return new Date(Math.min(253402300799999, Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0))).toISOString();
}

/** Media must have played every range; seeking to the end alone is insufficient. */
export function playedThrough(duration: number, ranges: Pick<TimeRanges, 'length' | 'start' | 'end'>) {
  if (!Number.isFinite(duration) || duration <= 0 || !ranges.length) return false;
  let covered = 0;
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) > covered + 0.05) return false;
    covered = Math.max(covered, ranges.end(i));
  }
  return covered >= duration - 0.05;
}
