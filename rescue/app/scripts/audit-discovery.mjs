import fs from 'node:fs';
import path from 'node:path';
const [output,mode]=process.argv.slice(2),production=mode==='production';
const config=JSON.parse(fs.readFileSync('firebase.json'));
const legacy=JSON.parse(fs.readFileSync('../qa/legacy-sitemap-paths.json'));
const redirects=new Map(config.hosting.redirects.map(x=>[x.source,x]));
const fileFor=p=>path.join(output,p==='/'?'index.html':p.slice(1)+'/index.html');
const errors=[];
for(const old of legacy){const r=redirects.get(old);if(r&&r.type!==301)errors.push('Not permanent: '+old);const dest=r?.destination||old;if(!fs.existsSync(fileFor(dest)))errors.push('Missing legacy target: '+old+' -> '+dest);}
const sitemap=fs.readFileSync(path.join(output,'sitemap.xml'),'utf8');
const urls=[...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(x=>x[1]);
const titles=new Set(),descriptions=new Set();let guides=0;
for(const url of urls){const u=new URL(url),file=fileFor(u.pathname);if(!fs.existsSync(file)){errors.push('Missing sitemap page '+url);continue;}const html=fs.readFileSync(file,'utf8');const title=html.match(/<title>(.*?)<\/title>/s)?.[1];const desc=html.match(/name="description" content="([^"]+)"/)?.[1];if(!title||!desc)errors.push('Missing metadata '+url);if(production&&(u.origin!=='https://minimalpairs.co'||!html.includes('name="robots" content="index,follow"')))errors.push('Wrong indexing '+url);if(!html.includes('rel="canonical" href="'+url+'"'))errors.push('Wrong canonical '+url);if(u.pathname.startsWith('/learn/')){guides++;if(titles.has(title)||descriptions.has(desc))errors.push('Duplicate guide metadata '+url);titles.add(title);descriptions.add(desc);if((html.match(/<h1[ >]/g)||[]).length!==1)errors.push('Wrong h1 count '+url);}}
// Keep account, player and editorial workspaces out of search, including translations.
const privateRoutes=['404','auth/action','account','practice','audio-review','word-review','word-review-previous','voice-audition','analytics-settings','membership-preview','restore-access','audio-comparison','english-audio-preview','human-audio-preview','audio-credits'];
const sitemapPaths=new Set(urls.map(url=>new URL(url).pathname.replace(/\/$/,'')));
let privatePages=0;
for(const prefix of ['',...['en','fr','es','de','it','pt','ru','ja','zh']])for(const route of privateRoutes){
 const page='/'+[prefix,route].filter(Boolean).join('/'),file=fileFor(page);
 if(!fs.existsSync(file))continue;
 privatePages++;
 const html=fs.readFileSync(file,'utf8');
 if(!/name="robots" content="noindex[,\s]/.test(html))errors.push('Private page lacks noindex '+page);
 if(sitemapPaths.has(page))errors.push('Private page in sitemap '+page);
}
if(errors.length)throw new Error(errors.join('\n'));
console.log(JSON.stringify({privatePages,noindexChecks:'passed'}));
console.log(JSON.stringify({mode,legacyUrls:legacy.length,sitemapPages:urls.length,guides,errors:0}));
