import type { Contrast, Pair } from './types';

const phrases = {
  vowel: {
    initial: 'Focus on the vowel at the beginning of each word.',
    medial: 'Focus on the vowel inside each word.',
    final: 'Focus on the vowel at the end of each word.',
    first: 'Listen to the first vowel in each word.',
    last: 'Listen to the last vowel in each word.',
  },
  consonant: {
    initial: 'Focus on the consonant at the beginning of each word.',
    medial: 'Focus on the consonant inside each word.',
    final: 'Focus on the consonant at the end of each word.',
  },
  sound: {
    initial: 'Focus on the sound at the beginning of each word.',
    medial: 'Focus on the sound inside each word.',
    final: 'Focus on the sound at the end of each word.',
  },
} as const;
const neutralFocus = 'Listen for the target sound in each word.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function focusPhrase(focus: unknown): string | undefined {
  // JSON content can bypass TypeScript. Never interpolate its fields into UI text.
  if (!isRecord(focus) || typeof focus.unit !== 'string' || typeof focus.position !== 'string') return;
  if (!Object.hasOwn(phrases, focus.unit)) return;
  const positions = phrases[focus.unit as keyof typeof phrases];
  if (Object.hasOwn(positions, focus.position)) return positions[focus.position as keyof typeof positions];
}

/** A/B's group determines focus, independently of X's category, voice or correct answer. */
export function practiceFocus(contrast: Contrast, reference?: Pair): string | undefined {
  if (!reference) return contrast.targetSoundFocus;
  const groups = contrast.abx?.focusByTrialGroup;
  if (groups !== undefined) {
    if (!isRecord(groups)) return neutralFocus;
    const rawGroup = reference.abx?.trialGroup;
    const group = rawGroup === undefined || rawGroup === '' ? 'all' : rawGroup;
    if (typeof group !== 'string') return neutralFocus;
    // An incomplete explicit map must not fall back to another group's instruction.
    return (Object.hasOwn(groups, group) ? focusPhrase(groups[group]) : undefined) || neutralFocus;
  }
  // Existing mixed-position consonant lessons predate explicit group descriptors.
  // Keep their wording unchanged; new vowel/mixed lessons declare their focus map.
  const position = reference.abx?.targetPosition;
  if (contrast.abx?.requireSameTargetPosition && (position === 'initial' || position === 'final')) {
    return focusPhrase({ unit: 'consonant', position });
  }
  return contrast.targetSoundFocus;
}
