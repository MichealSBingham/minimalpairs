"""Record reachability without storing or republishing reference-page bodies."""
import concurrent.futures, html, json, re, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
data=json.loads((ROOT/'curriculum.json').read_text())
urls=sorted({u for l in data['languages'] for c in l['contrasts'] for p in c['pairs'] for u in p['sources']} | {u for l in data['languages'] for c in l['contrasts'] for u in c['sources']})
previous={}
if (ROOT/'source-audit.json').exists():
    previous={r['url']:r for r in json.loads((ROOT/'source-audit.json').read_text())['sources']}
def check(url):
    if url in previous: return previous[url]
    result={'url':url,'date':'2026-09-28','contentValidation':'not-implied-by-http-status'}
    if 'mdbg.net' in url or 'gramota.ru' in url:
        return dict(result,status='not-fetched',error='No additional automated requests: publisher restriction or rate-limit observed. Use approved manual access or a licensed dataset.')
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (research reference check)'})
        with urllib.request.urlopen(req,timeout=15) as response:
            raw=response.read(2000000)
            result.update(httpStatus=response.status,finalUrl=response.url,contentType=response.headers.get('Content-Type',''))
        if 'pdf' not in result['contentType']:
            page=raw.decode('utf-8',errors='replace')
            title=re.search(r'<title[^>]*>(.*?)</title>',page,re.S|re.I)
            if title: result['title']=html.unescape(re.sub(r'<[^>]+>','',title[1])).strip()[:240]
            result['ipaTokens']=list(dict.fromkeys(html.unescape(re.sub(r'<[^>]+>','',m)).strip() for m in re.findall(r'<span[^>]*class="[^"]*\bipa\b[^"]*"[^>]*>(.*?)</span>',page,re.S)))[:8]
            result['status']='page-fetched'
            if result.get('title')=='Portail lexical':
                result['contentValidation']='empty-app-shell-observed; lexical text not verified from this HTTP retrieval'
        else: result['status']='pdf-fetched'
    except Exception as error:
        result.update(status='not-fetched',error=str(error)[:200])
    return result
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    results=list(executor.map(check,urls))
(ROOT/'source-audit.json').write_text(json.dumps({'date':'2026-09-28','limitations':'Reachability check, not independent linguistic validation. Source rights remain with publishers; no source audio imported.','sources':results},ensure_ascii=False,indent=2)+'\n')
print('References:',len(results),'fetched:',sum(r['status']!='not-fetched' for r in results))
for result in results:
    if result['status']=='not-fetched' or any(t in result.get('title','').lower() for t in ['error','not found','captcha']):
        print(result)
