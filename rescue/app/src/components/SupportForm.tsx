import { useRef, useState } from 'react';
import { commerce, commercePath } from '../lib/commerce-i18n';
export default function SupportForm({ locale = 'en' }: { locale?: string }) {
 const t = commerce(locale);
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);const requestId=useRef('');
 return done?<div role="status"><h2>{t('received')}</h2><p>{t('reference')} {status}</p><a href={commercePath(locale, "/practice")}>{t('backLessons')} →</a></div>:<form className="support-form" onSubmit={async e=>{e.preventDefault();if(busy)return;const data=new FormData(e.currentTarget);setBusy(true);setStatus('');requestId.current ||= crypto.randomUUID();try{const r=await fetch('https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),topic:data.get('topic'),message:data.get('message'),requestId:requestId.current}),signal:AbortSignal.timeout(15000)});const result=await r.json();if(!r.ok||!result.saved)throw new Error(r.status===429?t('rateLimit'):t('error'));setStatus(result.ticketId);setDone(true);}catch(err){setStatus(err instanceof Error && err.message === t('rateLimit') ? t('rateLimit') : t('error'));}finally{setBusy(false);}}}>
 <label>{t('email')}<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
 <label>{t('helpWith')}<select name="topic"><option value="account">{t('accountTopic')}</option><option value="billing">{t('billing')}</option><option value="audio">{t('audioTopic')}</option><option value="other">{t('other')}</option></select></label>
 <label>{t('message')}<textarea name="message" rows={5} minLength={5} maxLength={4000} required /></label>
 <p className="small-note">{t('noSecrets')}</p><button className="button button-dark" disabled={busy}>{busy?t('sending'):t('send')}</button><p role="status">{status}</p>
 </form>;
}
