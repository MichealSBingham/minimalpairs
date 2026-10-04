import {publicCopy} from '../src/lib/localized-public.ts';
import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2];
if(!root)throw Error('Pass built output directory');
const locales=['en','es','fr','pt','de','it','ru','ja','zh'];
const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>new URL(m[1]));
const fileFor=p=>path.join(root,p.replace(/^\//,''),'index.html');
const errors=[];let localized=0;
for(const url of urls){
 const match=url.pathname.match(/^\/(es|fr|pt|de|it|ru|ja|zh)(?=\/|$)/),locale=match?.[1]||'en';
 const html=fs.readFileSync(fileFor(url.pathname),'utf8');
 if(!html.includes(`lang="${locale}"`))errors.push(`Wrong lang ${url.pathname}`);
 if(!match)continue;
 localized++;
 if(url.pathname.includes('/learn/zh-tone-') && !html.includes(publicCopy(locale).tone)) errors.push('Missing tone-specific instructions '+url.pathname);
 const plain=url.pathname.replace(match[0],'')||'/';
 if((html.match(/<h1[ >]/g)||[]).length!==1)errors.push(`H1 ${url.pathname}`);
 for(const target of [...locales,'x-default']){
  const targetPath=target==='en'||target==='x-default'?plain:`/${target}${plain==='/'?'':plain}`;
  const href=new URL(targetPath,url.origin).href;
  if(!html.includes(`hreflang="${target}" href="${href}"`))errors.push(`Missing alternate ${target} ${url.pathname}`);
  if(!fs.existsSync(fileFor(targetPath)))errors.push(`Missing page ${targetPath}`);
 }
 if(!html.includes(`rel="canonical" href="${url.href}"`))errors.push(`Canonical ${url.pathname}`);
 for(const m of html.matchAll(/href="(\/(?:es|fr|pt|de|it|ru|ja|zh)(?:\/[^"?#]*)?)(?:[?#][^"]*)?"/g)){
  if(!fs.existsSync(fileFor(m[1])))errors.push(`Dead localized link ${m[1]} on ${url.pathname}`);
 }
}
if(!localized)errors.push('No localized public pages');
if(errors.length)throw Error([...new Set(errors)].slice(0,50).join('\n'));
console.log(JSON.stringify({locales:locales.length,localizedPublicPages:localized,errors:0}));
