export type Word = { text: string; ipa: string; meaning: string };
/** Fixed UI phrases only: content cannot inject example words or IPA into blind practice. */
export type AbxFocus = { unit: 'vowel'; position: 'initial' | 'medial' | 'final' | 'first' | 'last' } | { unit: 'consonant' | 'sound'; position: 'initial' | 'medial' | 'final' };
export type Pair = { id: string; words: [Word, Word]; kind: string; note?: string; sources?: string[]; abx?: { categoryByWordIndex?: [number, number]; targetTokenIndex?: number; targetPosition?: string; trialGroup?: string } };
export type Contrast = { id: string; label: string; phonemes: string[]; description: string; l1Notes?: {nativeLanguage: string; note: string}[]; pairs: Pair[]; sources?: string[]; targetSoundFocus?: string; abx?: { matchType?: string; prompt?: string; categoryLabels?: string[]; targetSoundFocus?: string; requireSameTargetPosition?: boolean; focusByTrialGroup?: Record<string, AbxFocus> } };
export type Language = { id: string; name: string; nativeName: string; locale: string; dialect: string; tagline: string; contrasts: Contrast[] };
