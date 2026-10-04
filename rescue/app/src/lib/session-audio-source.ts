export const DEVICE_AUDIO_COLLECTION = 'device-preview-v1';
export const MIXED_AUDIO_COLLECTION = 'mixed-audio-v1';
export const UNKNOWN_AUDIO_COLLECTION = 'unknown-audio-v1';

/** Classify the selected queue, not the requested manifest or a voice's quality.
 * Non-device profiles retain their requested collection identity; this does not
 * certify their provider, pronunciation, or speaker consistency.
 */
export function actualSessionAudioCollection(requested: string, voiceIds: readonly (string | undefined)[]): string {
  if (!voiceIds.length || voiceIds.some(id => typeof id !== 'string' || !id.trim() || id === 'device:')) return UNKNOWN_AUDIO_COLLECTION;
  const deviceCount = voiceIds.filter(id => id!.startsWith('device:')).length;
  if (deviceCount === voiceIds.length) return DEVICE_AUDIO_COLLECTION;
  if (deviceCount > 0) return MIXED_AUDIO_COLLECTION;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(requested)
    || [DEVICE_AUDIO_COLLECTION, MIXED_AUDIO_COLLECTION, UNKNOWN_AUDIO_COLLECTION].includes(requested)) return UNKNOWN_AUDIO_COLLECTION;
  return requested;
}

export function fallbackAudioSourceLabel(collectionId?: string): string {
  if (collectionId === DEVICE_AUDIO_COLLECTION) return 'Device voice preview';
  if (collectionId === MIXED_AUDIO_COLLECTION) return 'Mixed audio sources';
  if (collectionId === UNKNOWN_AUDIO_COLLECTION) return 'Audio source unconfirmed';
  return '';
}
