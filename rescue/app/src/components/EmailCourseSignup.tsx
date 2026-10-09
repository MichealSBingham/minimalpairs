import templates from '../../../company/email-course/templates.json';
import { useState } from 'react';
import { requestSubscription, subscriptionPayload } from '../lib/email-course.mjs';
export default function EmailCourseSignup({ endpoint, defaultLanguage = 'fr' }: { endpoint: string; defaultLanguage?: string }) {
 const [email,setEmail]=useState(''); const [language,setLanguage]=useState(templates.languages.some(item=>item.bankId===defaultLanguage)?defaultLanguage:'fr');
 const [course,setCourse]=useState(false); const [weekly,setWeekly]=useState(false);
 const [busy,setBusy]=useState(false); const [status,setStatus]=useState(''); const [done,setDone]=useState(false);
 async function submit(event: React.FormEvent) {event.preventDefault();if(busy||done)return;setStatus('');setBusy(true);
  try {await requestSubscription(endpoint,subscriptionPayload({email,language,course,weekly}));setDone(true);setEmail('');setStatus('Your request has been saved. Email verification is required before listening emails can start.');}
  catch(error){setStatus(error instanceof Error?error.message:'Please try again.');}finally{setBusy(false);}
 }
 return <section className="email-course-signup" aria-labelledby="email-course-title" style={{maxWidth:650,margin:'32px auto',padding:24,border:'1px solid var(--line)',borderRadius:12}}>
 <h2 id="email-course-title">Keep working on your listening.</h2><p>Three short listening challenges over a week, from Micheal at MinimalPairs. Your results stay available whether you subscribe or not.</p>
 <form onSubmit={submit}><fieldset disabled={busy||done} style={{border:0,padding:0}}>
 <label style={{display:'block',marginBottom:16}}>Email address<input type="email" autoComplete="email" maxLength={254} required value={email} onChange={e=>setEmail(e.target.value)} style={{display:'block',width:'100%',padding:12}} /></label>
 <label style={{display:'block',marginBottom:16}}>Listening language<select value={language} onChange={e=>setLanguage(e.target.value)} style={{display:'block',padding:12}}>{templates.languages.map(item=><option key={item.bankId} value={item.bankId}>{item.name}</option>)}</select></label>
 <p>The emails are written in English, with listening exercises for your selected language.</p>
 <label style={{display:'block',marginBottom:16}}><input type="checkbox" checked={course} onChange={e=>setCourse(e.target.checked)} /> Email me the three-part listening course for my selected language.</label>
 <label style={{display:'block',marginBottom:16}}><input type="checkbox" checked={weekly} onChange={e=>setWeekly(e.target.checked)} /> Also send me a weekly listening tip. I can unsubscribe at any time.</label>
 <p>Emails include practice links and information about full access. Both choices are optional and separate from analytics consent. <a href="/privacy#listening-emails">How we use your email</a>.</p>
 <button className="button button-dark" type="submit" disabled={busy||done||(!course&&!weekly)}>{busy?'Saving…':done?'Request saved':'Send my listening plan'}</button>
 </fieldset><p role="status" aria-live="polite">{status}</p></form>
 <p>To stop listening emails, use the unsubscribe link in any message. To change your language or preferences, <a href="/support">contact us</a>.</p>
 </section>;
}
