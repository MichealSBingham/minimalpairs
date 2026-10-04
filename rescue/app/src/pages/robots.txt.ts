export function GET() {
  const indexable = import.meta.env.PUBLIC_SITE_INDEXABLE === 'true';
  const base = import.meta.env.SITE_URL || 'https://minimalpairs.co';
  return new Response(indexable ? `User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /practice\nDisallow: /restore-access\nSitemap: ${base}/sitemap.xml\n` : 'User-agent: *\nAllow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
