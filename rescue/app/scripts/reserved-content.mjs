const textKey = value => String(value || '').normalize('NFC').trim().toLocaleLowerCase('en');
const ipaKey = (language, value) => {
  let ipa = String(value || '').normalize('NFC').replace(/[\[\]/\sˈˌ.]/gu, '');
  // The authored General American inventory writes /i/ rather than /iː/.
  if (language === 'en') ipa = ipa.replaceAll('iː', 'i');
  return ipa;
};

/** Expand the Mandarin split into the same spelling/pronunciation leak guard. */
export function withMandarinReservations(pool, balance) {
  if (!balance) return pool;
  const heldout = balance.lexicalItems.filter(word => word.split === 'heldout');
  const pairs = [];
  for (const frame of new Set(heldout.map(word => word.segmentalFrame))) {
    const words = heldout.filter(word => word.segmentalFrame === frame).sort((a,b) => a.tone-b.tone);
    if (words.length !== 4 || words.some((word,i)=>word.tone!==i+1)) throw new Error('Mandarin assessment frame must contain each of the four tones');
    pairs.push({id:`mandarin-heldout-${frame}-1-2`,words:words.slice(0,2)}, {id:`mandarin-heldout-${frame}-3-4`,words:words.slice(2)});
  }
  if (!pairs.length) throw new Error('Missing reserved Mandarin words');
  return {...pool,sets:[...pool.sets,{languageId:'zh',pairs}]};
}

/** Guard the shared training/export pool, not a person's lifetime exposure. */
export function assertReservedContentExcluded(languages, pool, audioManifests = []) {
  if (!Array.isArray(pool?.sets) || !pool.sets.length) throw new Error('The reserved assessment pool is missing or invalid.');
  const reserved = [];
  for (const set of pool.sets) {
    if (!['en', 'fr', 'de', 'es', 'it', 'zh', 'pt', 'ru'].includes(set?.languageId) || !Array.isArray(set.pairs) || !set.pairs.length) throw new Error('A reserved assessment set is incomplete.');
    for (const pair of set.pairs) {
      if (!Array.isArray(pair?.words) || pair.words.length !== 2) throw new Error('A reserved assessment pair is incomplete.');
      for (const word of pair.words) {
        if (typeof word?.text !== 'string' || typeof word?.ipa !== 'string' || !textKey(word.text) || !ipaKey(set.languageId, word.ipa)) throw new Error('A reserved assessment word is incomplete.');
        reserved.push({ languageId: set.languageId, text: textKey(word.text), ipa: ipaKey(set.languageId, word.ipa) });
      }
    }
  }
  const collisions = [];
  const inspect = (languageId, word, source) => {
    const text = textKey(word.text), ipa = ipaKey(languageId, word.ipa || word.targetIPA);
    for (const heldout of reserved) if (heldout.languageId === languageId && (heldout.text === text || (ipa && heldout.ipa === ipa))) {
      collisions.push({ source, languageId, trainingWord: word.text, reservedWord: heldout.text, reason: heldout.text === text ? 'word' : 'phonemic form' });
    }
  };
  for (const language of languages) for (const contrast of language.contrasts || []) for (const pair of contrast.pairs || []) for (const word of pair.words || []) inspect(language.id, word, `curriculum:${pair.id}`);
  for (const { path, manifest } of audioManifests) for (const clip of manifest.clips || []) inspect(clip.languageId, clip, path);
  if (collisions.length) throw new Error(`Reserved assessment material leaked into training or public audio:\n${JSON.stringify(collisions, null, 2)}`);
  return { reservedWords: reserved.length, audioManifestsChecked: audioManifests.length, collisions: 0 };
}
