import '../styles/recovery-offer.css';
export default function RecoveryOffer({expiresAt,onAccept,disabled=false,preview=false}:{expiresAt:number;onAccept?:()=>void;disabled?:boolean;preview?:boolean}) {
  return <aside className="recovery-offer" aria-labelledby="recovery-heading">
    <div className="recovery-copy"><span className="recovery-badge">YOUR LIFETIME OFFER · SAVE 50%</span><h2 id="recovery-heading">A little nudge.<br/><em>A lifetime of listening.</em></h2><p>Unlock every sound contrast, every language, and your detailed listening results.</p><div className="recovery-benefits"><span>✓ All languages</span><span>✓ Unlimited practice</span><span>✓ One payment</span></div></div>
    <div className="recovery-purchase"><p className="recovery-price"><del aria-label="Original price 29 dollars">$29</del><strong>$14<span>.50</span></strong></p><p className="recovery-once">USD once. Yours for life.</p><button className="button button-dark" onClick={onAccept} disabled={disabled}>{disabled ? 'Opening…' : 'Get lifetime access'} <span aria-hidden="true">→</span></button><p className="recovery-expiry">{preview ? 'Your offer lasts 48 hours.' : `Available until ${new Date(expiresAt*1000).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}.`}</p><p className="recovery-renewal">No subscription. No renewals.</p></div>
  </aside>;
}
