/** Device-local owner notes, not evidence of listening or approval to publish audio. */
export type AudioReviewStatus = 'unreviewed' | 'pass' | 'fix' | 'unsure';
export type AudioReview = { status: AudioReviewStatus; note: string; updatedAt: string };
export type AudioReviewState = {
  schemaVersion: 1;
  clipReviews: Record<string, AudioReview>;
  groupReviews: Record<string, AudioReview>;
};
export type AudioReviewStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type AudioReviewImport = {
  state: AudioReviewState;
  skippedUnknownClips: number;
  skippedUnknownGroups: number;
  skippedInvalidClips: number;
  skippedInvalidGroups: number;
};

export const AUDIO_REVIEW_STORAGE_KEY = 'minimalpairs.audio-review.v1';
export const MAX_AUDIO_REVIEW_NOTE_LENGTH = 2000;
export const MAX_AUDIO_REVIEW_RECORDS = 10000;
const MAX_SERIALIZED_LENGTH = 30_000_000;
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const statuses = new Set<AudioReviewStatus>(['unreviewed', 'pass', 'fix', 'unsure']);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Only own data properties: imported objects cannot run getters during parsing. */
function own(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function validId(id: string): boolean {
  return id.length > 0 && id.length <= 1000 && id.trim().length > 0
    && !unsafeKeys.has(id) && !/[\u0000-\u001f\u007f]/.test(id);
}

/** Accept explicit-zone ISO timestamps; normalize valid calendar dates to UTC. */
function timestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return null;
  const local = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const localDate = new Date(local);
  if (!Number.isFinite(localDate.getTime()) || localDate.toISOString() !== local) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const normalized = date.toISOString();
  // Keep every accepted value round-trippable through this same four-digit schema.
  return normalized.length === 24 ? normalized : null;
}

function review(value: unknown): AudioReview | null {
  if (!isRecord(value)) return null;
  const status = own(value, 'status');
  const note = own(value, 'note');
  const updatedAt = timestamp(own(value, 'updatedAt'));
  if (typeof status !== 'string' || !statuses.has(status as AudioReviewStatus)
    || typeof note !== 'string' || updatedAt === null) return null;
  return {
    status: status as AudioReviewStatus,
    note: note.slice(0, MAX_AUDIO_REVIEW_NOTE_LENGTH).replace(/[\uD800-\uDBFF]$/, ''),
    updatedAt,
  };
}

export function emptyReviewState(): AudioReviewState {
  return { schemaVersion: 1, clipReviews: {}, groupReviews: {} };
}

/**
 * Malformed envelopes and oversized imports fail as a whole; malformed entries
 * are skipped. Exact inventory IDs (including content hashes) are never remapped.
 * Supply both allowlists when importing a backup into the current inventory.
 * Omit them only when reading/exporting an archive that may include older clips.
 */
export function parseReviewStateWithReport(
  value: unknown,
  knownClipIds?: readonly string[],
  knownGroupIds?: readonly string[],
): AudioReviewImport | null {
  try {
    if (typeof value === 'string') {
      if (value.length > MAX_SERIALIZED_LENGTH) return null;
      value = JSON.parse(value);
    }
    if (!isRecord(value) || own(value, 'schemaVersion') !== 1) return null;
    const clips = own(value, 'clipReviews');
    const groups = own(value, 'groupReviews');
    if (!isRecord(clips) || !isRecord(groups)) return null;
    const clipIds = Object.keys(clips);
    const groupIds = Object.keys(groups);
    if (clipIds.length + groupIds.length > MAX_AUDIO_REVIEW_RECORDS) return null;
    const result: AudioReviewImport = {
      state: emptyReviewState(), skippedUnknownClips: 0, skippedUnknownGroups: 0,
      skippedInvalidClips: 0, skippedInvalidGroups: 0,
    };
    const copy = (
      source: Record<string, unknown>, ids: string[], target: Record<string, AudioReview>,
      known: readonly string[] | undefined, unknownCount: 'skippedUnknownClips' | 'skippedUnknownGroups',
      invalidCount: 'skippedInvalidClips' | 'skippedInvalidGroups',
    ) => {
      const allowed = known === undefined ? null : new Set(known);
      for (const id of ids) {
        if (!validId(id)) { result[invalidCount] += 1; continue; }
        if (allowed !== null && !allowed.has(id)) { result[unknownCount] += 1; continue; }
        const entry = review(own(source, id));
        if (!entry) { result[invalidCount] += 1; continue; }
        target[id] = entry;
      }
    };
    copy(clips, clipIds, result.state.clipReviews, knownClipIds, 'skippedUnknownClips', 'skippedInvalidClips');
    copy(groups, groupIds, result.state.groupReviews, knownGroupIds, 'skippedUnknownGroups', 'skippedInvalidGroups');
    return result;
  } catch { return null; }
}

export function parseReviewState(
  value: unknown, knownClipIds?: readonly string[], knownGroupIds?: readonly string[],
): AudioReviewState | null {
  return parseReviewStateWithReport(value, knownClipIds, knownGroupIds)?.state ?? null;
}

/** Newer notes win; ties keep the existing note. No status has special priority. */
export function mergeReviewState(existing: AudioReviewState, incoming: AudioReviewState): AudioReviewState | null {
  const left = parseReviewState(existing);
  const right = parseReviewState(incoming);
  if (!left || !right) return null;
  const merged = emptyReviewState();
  for (const kind of ['clipReviews', 'groupReviews'] as const) {
    for (const [id, entry] of Object.entries(left[kind])) merged[kind][id] = { ...entry };
    for (const [id, entry] of Object.entries(right[kind])) {
      const previous = merged[kind][id];
      if (!previous || entry.updatedAt > previous.updatedAt) merged[kind][id] = { ...entry };
    }
  }
  // Reject instead of silently throwing away unrelated review history.
  return Object.keys(merged.clipReviews).length + Object.keys(merged.groupReviews).length > MAX_AUDIO_REVIEW_RECORDS
    ? null : merged;
}

function storageOrDefault(storage?: AudioReviewStorage): AudioReviewStorage | null {
  if (storage) return storage;
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

/** Missing storage content is empty; corrupt or inaccessible storage returns null. */
export function readReviewState(storage?: AudioReviewStorage): AudioReviewState | null {
  try {
    const target = storageOrDefault(storage);
    if (!target) return null;
    const raw = target.getItem(AUDIO_REVIEW_STORAGE_KEY);
    return raw === null ? emptyReviewState() : parseReviewState(raw);
  } catch { return null; }
}

/** Verify persistence before the UI says a note is saved. No network side effects. */
export function writeReviewState(state: AudioReviewState, storage?: AudioReviewStorage): boolean {
  try {
    const parsed = parseReviewStateWithReport(state);
    const target = storageOrDefault(storage);
    if (!target || !parsed || parsed.skippedInvalidClips || parsed.skippedInvalidGroups) return false;
    const serialized = JSON.stringify(parsed.state);
    target.setItem(AUDIO_REVIEW_STORAGE_KEY, serialized);
    return target.getItem(AUDIO_REVIEW_STORAGE_KEY) === serialized;
  } catch { return false; }
}

export type AudioReviewCsvCell = string | number | boolean | null | undefined;
/** Quotes every field and neutralizes spreadsheet formulas, including in headers. */
export function audioReviewCsv(headers: readonly string[], rows: readonly (readonly AudioReviewCsvCell[])[]): string {
  const cell = (value: AudioReviewCsvCell): string => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) {
    if (row.length !== headers.length) throw new RangeError('Every CSV row must match the header length.');
    lines.push(row.map(cell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
