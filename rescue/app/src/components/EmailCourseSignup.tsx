import {productEvent} from '../lib/product-reporting';
import templates from '../../../company/email-course/templates.json';
import { useState } from 'react';
import { requestSubscription, subscriptionPayload } from '../lib/email-course.mjs';
const launchLanguages=templates.languages.filter(item=>['en-US-ga','fr'].includes(item.bankId));
export default function EmailCourseSignup({ endpoint, defaultLanguage = 'fr' }: { endpoint: string; defaultLanguage?: string }) {
 const [email,setEmail]=useState(''); const [language,setLanguage]=useState(launchLanguages.some(item=>item.bankId===defaultLanguage)?defaultLanguage:'fr');

 const [busy,setBusy]=useState(false); const [status,setStatus]=useState(''); const [done,setDone]=useState(false);
 async function submit(event: React.FormEvent) {event.preventDefault();if(busy||done)return;setStatus('');setBusy(true);
  try {await requestSubscription(endpoint,subscriptionPayload({email,language,course:true,weekly:true}));void productEvent('course_signup',{language_id:language==='en-US-ga'?'en':language});setDone(true);setEmail('');setStatus('Your subscription request has been saved.');}
  catch(error){setStatus(error instanceof Error?error.message:'Please try again.');}finally{setBusy(false);}
 }
 return <section className="email-course-signup" aria-labelledby="email-course-title" style={{maxWidth:650,margin:'32px auto',padding:24,border:'1px solid var(--line)',borderRadius:12}}>
 <h2 id="email-course-title">Keep working on your listening.</h2><p>Three short listening challenges this week, then one listening tip a week from Micheal at MinimalPairs.</p>
 <form onSubmit={submit}><fieldset disabled={busy||done} style={{border:0,padding:0}}>
 <label style={{display:'block',marginBottom:16}}>Email address<input type="email" autoComplete="email" maxLength={254} required value={email} onChange={e=>setEmail(e.target.value)} style={{display:'block',width:'100%',padding:12}} /></label>
 <label style={{display:'block',marginBottom:16}}>Listening language<select value={language} onChange={e=>setLanguage(e.target.value)} style={{display:'block',padding:12}}>{launchLanguages.map(item=><option key={item.bankId} value={item.bankId}>{item.name}</option>)}</select></label>
 <p>The emails are written in English, with listening exercises for your selected language.</p>
 <p>Emails include practice links and information about full access. By selecting “Send my listening plan”, you subscribe to the three-part course followed by weekly listening tips. Unsubscribe anytime. Email signup is separate from analytics consent. <a href="/privacy#listening-emails">How we use your email</a>.</p>
 <button className="button button-dark" type="submit" disabled={busy||done}>{busy?'Saving…':done?'Request saved':'Send my listening plan'}</button>
 </fieldset><p role="status" aria-live="polite">{status}</p></form>
 <p>To stop listening emails, use the unsubscribe link in any message. To change your language or preferences, <a href="/support">contact us</a>.</p>
 </section>;
}
