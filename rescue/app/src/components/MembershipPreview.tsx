import { useState } from 'react';
import type { Language } from '../lib/types';

type View = 'free' | 'monthly' | 'annual' | 'lifetime' | 'legacy-lifetime';
export default function MembershipPreview({languages}:{languages:Language[]}) {
 const [view,setView]=useState<View>('free');
 const [language,setLanguage]=useState(languages[0].id);
 const [selected,setSelected]=useState('');
 const current=languages.find(l=>l.id===language)!;
 const paid=view!=='free';
 return <div>
  <div className="editorial-panel"><strong>Owner preview · simulated access</strong><p>This page does not change your account, create a subscription or charge a card.</p>
   <label>View as <select value={view} onChange={e=>{setView(e.target.value as View);setSelected('');}}>{(['free','monthly','lifetime','annual','legacy-lifetime'] as View[]).map(v=><option key={v} value={v}>{v==='free'?'Free learner':v==='legacy-lifetime'?'Existing lifetime customer':v==='lifetime'?'Lifetime customer':v==='annual'?'Existing annual member':'Monthly member'}</option>)}</select></label>
  </div>
  <section><h2>{(view==='lifetime'||view==='legacy-lifetime')?'Your lifetime access':paid?'Your full listening library':'Start hearing the difference'}</h2>
   <p>{view==='legacy-lifetime'?'Your original lifetime coverage is honored, including future trainers where promised. No renewal or subscription required.':view==='lifetime'?'All current courses and their improvements. $29 USD paid once, with no renewal.':paid?`All ${languages.length} available languages and ${languages.reduce((total,l)=>total+l.contrasts.length,0)} sound groups. ${view==='annual'?'$49 USD billed annually':'$7 USD billed monthly'}. Renews until canceled.`:'A free diagnostic across the available sound groups, with results included, plus three free exercises in each language. No card required.'}</p>
   {!paid&&<div className="editorial-link-grid"><div className="editorial-panel"><h3>Monthly</h3><strong>$7 / month</strong><p>All available languages and sound groups.</p><button className="button button-dark" onClick={()=>setView('monthly')}>Preview monthly access</button></div><div className="editorial-panel"><h3>Lifetime</h3><strong>$29 once</strong><p>All current courses and their improvements. No renewal.</p><button className="button button-dark" onClick={()=>setView('lifetime')}>Preview lifetime access</button></div></div>}
   <label>Language <select value={language} onChange={e=>{setLanguage(e.target.value);setSelected('');}}>{languages.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   <div className="editorial-link-grid" style={{marginTop:20}}>{current.contrasts.map((c,i)=>{const locked=!paid&&i>=3;return <div className="editorial-panel" key={c.id} style={{padding:20}}><strong>{c.label}</strong><p>{c.phonemes.join(' / ')} · {locked?'Included with membership':'Available to practice'}</p>{locked?<button className="button" onClick={()=>setSelected(c.label)}>🔒 Unlock this sound group</button>:<a className="button button-dark" href={`/practice?language=${current.id}&contrast=${encodeURIComponent(c.id)}`}>Practice →</a>}</div>;})}</div>
   {selected&&!paid&&<div role="status" className="editorial-panel"><strong>{selected} is part of the full library.</strong><p>Continue with monthly access for $7/month or lifetime access for $29 once. This is a preview; no purchase will occur.</p><button className="button button-dark" onClick={()=>{setView('lifetime');setSelected('');}}>Preview unlocked access</button></div>}
  </section>
 </div>;
}
