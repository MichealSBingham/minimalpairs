import { useRef, useState } from 'react';
export default function SupportForm() {
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);const requestId=useRef('');
 return done?<div role="status"><h2>Message received.</h2><p>Your reference: {status}</p><a href="/practice">Back to lessons →</a></div>:<form className="support-form" onSubmit={async e=>{e.preventDefault();if(busy)return;const data=new FormData(e.currentTarget);setBusy(true);setStatus('');requestId.current ||= crypto.randomUUID();try{const r=await fetch('https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),topic:data.get('topic'),message:data.get('message'),requestId:requestId.current}),signal:AbortSignal.timeout(15000)});const result=await r.json();if(!r.ok||!result.saved)throw new Error(r.status===429?'Please try again tomorrow.':'Could not send. Please try again.');setStatus(result.ticketId);setDone(true);}catch(err){setStatus(err instanceof Error?err.message:'Could not send. Please try again.');}finally{setBusy(false);}}}>
 <label>Your email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
 <label>What can we help with?<select name="topic"><option value="account">Account or access</option><option value="billing">Billing</option><option value="audio">A recording or exercise</option><option value="other">Something else</option></select></label>
 <label>Message<textarea name="message" rows={5} minLength={5} maxLength={4000} required /></label>
 <p className="small-note">Please leave out passwords and card details.</p><button className="button button-dark" disabled={busy}>{busy?'Sending…':'Send message'}</button><p role="status">{status}</p>
 </form>;
}
