import {localizedLanguage,type PublicLocale} from '../lib/localized-public';
import { navCopy, localPath } from '../lib/locales';
import type { ReactNode } from 'react';

export type { Word, Pair, Contrast, Language } from '../lib/types';
export type PracticeSession = { id: string; mode?: 'abx-cross-word' | 'word-identification'; schemaVersion?: number; purpose?: 'focused' | 'mixed' | 'diagnostic'; textHintsUsed?: boolean; audioCollectionId?: string; completedAt: string; languageId: string; contrastId: string; correct: number; total: number; mistakes: { pairId: string; word: string; chosenWord: string }[] };
export type Progress = { sessions: PracticeSession[]; preferredLanguage?: string; nativeLanguage?: string };
export const PROGRESS_KEY = 'minimalpairs.progress.v1';

export function readProgress(): Progress {
  if (typeof window === 'undefined') return { sessions: [] };
  try {
    const data = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
    return { ...data, sessions: Array.isArray(data.sessions) ? data.sessions : [] };
  } catch { return { sessions: [] }; }
}

export function writeProgress(data: Progress): boolean {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(data)); return true; }
  catch { return false; }
}

export function Icon({ name, size = 20, ...props }: { name: string; size?: number; [key: string]: unknown }) {
  const paths: Record<string, ReactNode> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    play: <path d="m9 5 11 7-11 7V5Z" />,
    volume: <><path d="m11 4-5 4H3v8h3l5 4V4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></>,
    replay: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    chevron: <path d="m8 5 7 7-7 7" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12h3v8H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2ZM20 12h-3v8h3a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2Z" /></>,
    chart: <><path d="M4 3v17h17M8 15v-3M13 15V8M18 15V5" /></>,
    book: <><path d="M12 5v16M12 5C8 2 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-6-2-10 1Z" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" /></>,
    sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.arrow}</svg>;
}

export function Brand({locale = 'en'}: {locale?: string} = {}) {
  return <a className="brand" href={localPath(locale,'/')} aria-label="MinimalPairs home"><span>Minimal<em>Pairs</em></span><span className="brand-ipa" aria-hidden="true">/ˈmɪnɪməl pɛəz/</span></a>;
}

export function Header({ active, locale = 'en' }: { active?: 'practice' | 'account'; locale?: string }) {
  const t=navCopy[locale]||navCopy.en, href=(p:string)=>localPath(locale,p);
  return <header className="site-header"><div className="header-inner"><Brand locale={locale}/><nav className="header-nav" aria-label={t[1]}><a href={href('/')+'#how-it-works'}>{t[0]}</a><a href={href('/')+'#languages'}>{t[1]}</a><a href={href('/french-minimal-pairs')}>{t[2]}</a></nav><div className="header-actions"><a className={`account-link ${active === 'account' ? 'is-active' : ''}`} href={href('/account')}><span>{t[3]}</span></a><a className="button button-dark header-start" href={href('/practice')} aria-current={active === 'practice' ? 'page' : undefined}>{t[4]} <Icon name="arrow" size={15}/></a></div><details className="mobile-nav"><summary aria-label={t[4]}><span aria-hidden="true">☰</span></summary><nav aria-label={t[1]}><a href={href('/practice')}>{t[4]}</a><a href={href('/')+'#how-it-works'}>{t[0]}</a><a href={href('/')+'#languages'}>{t[1]}</a><a href={href('/french-minimal-pairs')}>{t[2]}</a><a href={href('/account')}>{t[3]}</a></nav></details></div></header>;
}

export function Footer({locale = 'en'}: {locale?: string} = {}) {
  const t=navCopy[locale]||navCopy.en, href=(p:string)=>localPath(locale,p);
  const guides=[['en','English','english'],['fr','French','french'],['de','German','german'],['es','Spanish','spanish'],['it','Italian','italian'],['zh','Mandarin Chinese','mandarin-chinese'],['pt','Portuguese','portuguese'],['ru','Russian','russian'],['ja','Japanese','japanese']];
  return <footer className="site-footer"><div className="footer-library"><span className="eyebrow">{t[2]}</span><nav aria-label={t[2]}>{guides.map(([id,name,slug])=><a href={href(`/${slug}-minimal-pairs`)} key={id}>{locale==='en'?name:localizedLanguage(id,locale as PublicLocale)}</a>)}</nav></div><div className="footer-inner"><div><Brand locale={locale}/><p>{t[10]}</p></div><nav aria-label={t[7]}><a href={href('/practice')}>{t[5]}</a><a href={href('/pricing')}>{t[6]}</a><a href={href('/account')}>{t[3]}</a><a href={href('/support')}>{t[7]}</a>{locale==='en'&&<><a href="/method">The method</a><a href="/teachers">For teachers</a></>}<a href="/privacy" lang="en">{t[8]}{locale!=='en'?' (English)':''}</a><a href="/terms" lang="en">{t[9]}{locale!=='en'?' (English)':''}</a></nav></div></footer>;
}

export function Waveform({ active = false, compact = false }: { active?: boolean; compact?: boolean }) {
  const heights = [12, 21, 32, 18, 40, 52, 34, 59, 76, 47, 30, 56, 38, 68, 43, 27, 51, 35, 62, 44, 25, 41, 30, 19, 10];
  return <span className={`waveform ${active ? 'is-playing' : ''} ${compact ? 'is-compact' : ''}`} aria-hidden="true">{heights.map((height, i) => <i key={i} style={{ height: `${height}%`, animationDelay: `${i * 33}ms` }} />)}</span>;
}
