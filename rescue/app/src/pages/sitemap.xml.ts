import { getGuideLanguages as getLanguages, slugFor } from '../lib/content';
export function GET() {
  const base = import.meta.env.SITE_URL || 'https://minimalpairs.co';
  const paths = ['/', '/teachers', '/method', '/pricing', ...getLanguages().flatMap(language => [`/${slugFor(language)}`, ...language.contrasts.map(contrast => `/learn/${contrast.id}`)])];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${new URL(path, base).toString()}</loc></url>`).join('')}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
