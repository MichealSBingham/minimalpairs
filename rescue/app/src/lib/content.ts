import { getPhonemeLibrary } from './phoneme-library';
import fs from 'node:fs';
import path from 'node:path';
import usEnglish from '../data/us-chatterbox-curriculum.json';
import type { Language } from './types';
const file = path.resolve(process.cwd(), '../content/curriculum.json');
export function getLanguages(): Language[] {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const languages: Language[] = Array.isArray(data) ? data : data.languages || [];
  return languages;
}
export const slugFor = (language: Language) => language.id === 'zh' ? 'mandarin-chinese-minimal-pairs' : `${language.name.toLowerCase().replace(/\s+/g, '-')}-minimal-pairs`;

export function getPracticeLanguages(): Language[] {
  return [usEnglish as Language, ...['fr','de','es','it','zh','pt','ru','ja'].map(bank => JSON.parse(fs.readFileSync(path.resolve(`src/data/${bank}-chatterbox-curriculum.json`),'utf8')) as Language)];
}

/** Public reference pages cover the reviewed bank, including varieties awaiting audio. */
export function getGuideLanguages(): Language[] {
  const result = getPracticeLanguages().map(l => ({...l, contrasts: [...l.contrasts]}));
  const library = getPhonemeLibrary();
  for (const bank of library.banks) {
    let language = result.find(l => l.id === (bank.id === 'en-US-ga' ? 'en' : bank.id));
    if (!language) {
      const base = library.languages.find(l => l.id === bank.languageId)!;
      language = {...base, id: bank.id, name: bank.id === 'en-GB-ssbe' ? 'British English' : base.name, locale: bank.id === 'en-GB-ssbe' ? 'en-GB' : bank.languageId, dialect: bank.reference, tagline: '', contrasts: []};
      result.push(language);
    }
    for (const item of library.contrasts.filter(c => (c.varietyId || c.languageId) === bank.id)) {
      if (language.contrasts.some(c => c.id === item.id)) continue;
      const pairs = item.minimalPairs.map((p,i) => ({id: `${item.id}-guide-${i}`, kind:'minimal', words:[library.words[p.leftWordId],library.words[p.rightWordId]] as [import('./types').Word,import('./types').Word]}));
      if (!pairs.length) continue;
      language.contrasts.push({id:item.id,label:item.label,phonemes:item.categories.map(c=>c.ipa),description:[item.rationale,item.scopeNote].filter(Boolean).join(' '),pairs,sources:item.sourceIds.map(id=>library.sources.find(s=>s.id===id)?.url).filter((url): url is string=>Boolean(url))});
    }
  }
  return result;
}
