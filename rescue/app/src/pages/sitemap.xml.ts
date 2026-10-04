import { getGuideLanguages as getLanguages, getPracticeLanguages, slugFor } from '../lib/content';
import { locales, localPath } from '../lib/locales';
export function GET() {
  const base = import.meta.env.SITE_URL || 'https://minimalpairs.co';
  const translated = ['/', '/pricing', '/support', ...getPracticeLanguages().map(language=>`/diagnostic/${language.id}`), ...getLanguages().flatMap(language => [`/${slugFor(language)}`, ...language.contrasts.map(contrast => `/learn/${contrast.id}`)])];
  const links=(path:string)=>[...locales.map(locale=>`<xhtml:link rel="alternate" hreflang="${locale}" href="${new URL(localPath(locale,path),base)}"/>`),`<xhtml:link rel="alternate" hreflang="x-default" href="${new URL(path,base)}"/>`].join('');
  const entries=translated.flatMap(path=>locales.map(locale=>`<url><loc>${new URL(localPath(locale,path),base)}</loc>${links(path)}</url>`));
  entries.push(...['/teachers','/method'].map(path=>`<url><loc>${new URL(path,base)}</loc></url>`));
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join('')}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
