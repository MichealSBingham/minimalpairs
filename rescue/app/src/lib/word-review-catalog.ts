// Server-only text inventory. It neither reads audio manifests nor generates media.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { humanLibraryLanguages } from './human-library.ts';
import type { Language, Pair, Word } from './types';
export type TextFinding = { languageId?: string; contrastId: string; pairId?: string; severity: string; message: string; suggestedCorrection?: string; sources: string[] };
export type TextWord = Word & { romanization?: string; phonemes?: string[] };
export type TextPair = { id: string; key: string; words: [TextWord, TextWord]; kind: string; note: string; target: string[]; position: string; trialGroup: string; sources: string[]; findings: TextFinding[] };
export type TextGroup = { id: string; key: string; languageId: string; languageName: string; languageDialect: string; dialect: string; dialectNote: string; scope: 'main' | 'preview'; label: string; categories: string[]; description: string; focus: string; sources: string[]; findings: TextFinding[]; pairs: TextPair[] };
export type WordReviewCatalog = { version: 1; fingerprint: string; groups: TextGroup[]; languages: { id: string; name: string; nativeName: string; dialect: string }[]; coverageGaps: { languageId: string; label: string }[]; auditSummaries: string[] };
const strings = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
function stable(value: unknown): string { return value !== null && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable((value as Record<string, unknown>)[k])).join(',') + '}' : JSON.stringify(value) ?? 'null'; }
const hash = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex');
const safeSources = (v: unknown) => strings(v).filter(s => /^https:\/\//.test(s));
export function buildWordReviewCatalog(languages: Language[], preview: Language[], findings: TextFinding[] = [], coverageGaps: WordReviewCatalog['coverageGaps'] = [], auditSummaries: string[] = []): WordReviewCatalog {
  const groups: TextGroup[] = [];
  for (const [scope, packs] of [['main', languages], ['preview', preview]] as const) for (const language of packs) for (const contrast of language.contrasts) {
    if (scope === 'preview' && languages.some(l => l.id === language.id && l.contrasts.some(c => c.id === contrast.id))) continue;
    const localized = contrast as typeof contrast & { dialect?: string; dialectNote?: string };
    const dialect = localized.dialect || language.dialect, dialectNote = localized.dialectNote || '';
    const relevant = findings.filter(f => f.contrastId === contrast.id && (!f.languageId || f.languageId === language.id));
    const pairs: TextPair[] = contrast.pairs.map((raw: Pair) => {
      const words = raw.words.map(w => { const source = w as TextWord; return { text: source.text, ipa: source.ipa, meaning: source.meaning, ...(source.romanization ? { romanization: source.romanization } : {}), ...(source.phonemes ? { phonemes: [...source.phonemes] } : {}) }; }) as [TextWord, TextWord];
      const index = raw.abx?.targetTokenIndex;
      const target = typeof index === 'number' ? words.map(word => word.phonemes?.[index] || '') : [];
      const value = { id: raw.id, words, kind: raw.kind, note: raw.note || '', target, position: raw.abx?.targetPosition || '', trialGroup: raw.abx?.trialGroup || 'all', sources: safeSources(raw.sources), findings: relevant.filter(f => f.pairId === raw.id) };
      return { ...value, key: `pair-${hash({ value, languageId: language.id, languageDialect: language.dialect, dialect, dialectNote, categories: contrast.phonemes, grouping: raw.abx, contrastGrouping: contrast.abx })}` };
    });
    const value = { id: contrast.id, languageId: language.id, languageName: language.name, languageDialect: language.dialect, dialect, dialectNote, scope, label: contrast.label, categories: [...contrast.phonemes], description: contrast.description, focus: contrast.targetSoundFocus || contrast.abx?.targetSoundFocus || '', sources: safeSources(contrast.sources), findings: relevant.filter(f => !f.pairId), pairs };
    groups.push({ ...value, key: `group-${hash({ value, grouping: contrast.abx })}` });
  }
  const value = { version: 1 as const, groups, languages: languages.map(({ id, name, nativeName, dialect }) => ({ id, name, nativeName, dialect })), coverageGaps, auditSummaries };
  return { ...value, fingerprint: hash(value) };
}
export function getWordReviewCatalog(): WordReviewCatalog {
  const content = path.resolve(process.cwd(), '../content');
  const raw = JSON.parse(fs.readFileSync(path.join(content, 'curriculum.json'), 'utf8'));
  const languages = (Array.isArray(raw) ? raw : raw.languages) as Language[];
  const reports = ['text-review-audit-fr.json', 'text-review-audit-en-de.json', 'text-review-audit-other.json'].filter(f => fs.existsSync(path.join(content, f))).map(f => JSON.parse(fs.readFileSync(path.join(content, f), 'utf8')));
  const findings: TextFinding[] = reports.flatMap(report => (report.findings || []).map((finding: TextFinding) => ({ contrastId: finding.contrastId, ...(finding.languageId || report.languageId ? { languageId: finding.languageId || report.languageId } : {}), ...(finding.pairId ? { pairId: finding.pairId } : {}), severity: finding.severity, message: finding.message, ...(typeof finding.suggestedCorrection === 'string' ? { suggestedCorrection: finding.suggestedCorrection } : {}), sources: safeSources(finding.sources) })));
  const legacy = JSON.parse(fs.readFileSync(path.join(content, 'legacy-coverage.json'), 'utf8'));
  const coverageGaps = legacy.routes.filter((r: {status:string}) => r.status === 'missing-contrast').map((r: {language:string;legacyDeclaredLabel?:string;legacyPath:string}) => ({ languageId: r.language, label: r.legacyDeclaredLabel || r.legacyPath }));
  return buildWordReviewCatalog(languages, humanLibraryLanguages(languages), findings, coverageGaps, reports.map(r => typeof r.summary === 'string' ? r.summary : '').filter(Boolean));
}
