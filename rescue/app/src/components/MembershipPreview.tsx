import { useState } from 'react';
import type { Language } from '../lib/types';

type View = 'free' | 'monthly' | 'annual' | 'lifetime';
export default function MembershipPreview({languages}:{languages:Language[]}) {
 const [view,setView]=useState<View>('free');
 const [language,setLanguage]=useState(languages[0].id);
 const [selected,setSelected]=useState('');
 const current=languages.find(l=>l.id===language)!;
 const paid=view!=='free';
 return <div>
  <div className="editorial-panel"><strong>Owner preview · simulated access</strong><p>This page does not change your account, create a subscription or charge a card. Public practice remains free while billing is prepared.</p>
   <label>View as <select value={view} onChange={e=>{setView(e.target.value as View);setSelected('');}}>{(['free','monthly','annual','lifetime'] as View[]).map(v=><option key={v} value={v}>{v==='free'?'Free learner':v==='lifetime'?'Existing lifetime customer':v==='annual'?'Annual member':'Monthly member'}</option>)}</select></label>
  </div>
  <section><h2>{view==='lifetime'?'Your lifetime access is honored':paid?'Your full listening library':'Start hearing the difference'}</h2>
   <p>{view==='lifetime'?'All current and future trainers included under the existing lifetime grants. No renewal or subscription required.':paid?`All nine available languages and 145 sound groups. ${view==='annual'?'$49 USD billed annually':'$7 USD billed monthly'}. Renews until canceled.`:'Three starter sound groups in each language, with unlimited practice and all four voices in those groups. No card required.'}</p>
   {!paid&&<div className="editorial-link-grid"><div className="editorial-panel"><h3>Monthly</h3><strong>$7 / month</strong><p>All available languages and sound groups.</p><button className="button button-dark" onClick={()=>setView('monthly')}>Preview monthly access</button></div><div className="editorial-panel"><h3>Annual</h3><strong>$49 / year</strong><p>About $4.08/month, billed as $49 annually.</p><button className="button button-dark" onClick={()=>setView('annual')}>Preview annual access</button></div></div>}
   <label>Language <select value={language} onChange={e=>{setLanguage(e.target.value);setSelected('');}}>{languages.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   <div className="editorial-link-grid" style={{marginTop:20}}>{current.contrasts.map((c,i)=>{const locked=!paid&&i>=3;return <div className="editorial-panel" key={c.id} style={{padding:20}}><strong>{c.label}</strong><p>{c.phonemes.join(' / ')} · {locked?'Included with membership':'Available to practice'}</p>{locked?<button className="button" onClick={()=>setSelected(c.label)}>🔒 Unlock this sound group</button>:<a className="button button-dark" href={`/practice?language=${current.id}&contrast=${encodeURIComponent(c.id)}`}>Practice →</a>}</div>;})}</div>
   {selected&&!paid&&<div role="status" className="editorial-panel"><strong>{selected} is part of the full library.</strong><p>Continue with monthly access for $7/month or annual access for $49/year. This is a preview; no purchase will occur.</p><button className="button button-dark" onClick={()=>{setView('annual');setSelected('');}}>Preview unlocked access</button></div>}
  </section>
 </div>;
}
