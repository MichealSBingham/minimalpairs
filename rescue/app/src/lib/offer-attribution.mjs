/** Coarse offer labels only; no user identifiers or arbitrary strings. */
export const OFFER_KEY='minimalpairs.offer-context.v1';
export function offerAttribution(raw={}) {
 const out={};
 if(['diagnostic-report','post-lesson','locked-lesson'].includes(raw.offer_placement))out.offer_placement=raw.offer_placement;
 if((raw.experiment_id==='diag-paywall-v1'&&['preview','paid'].includes(raw.experiment_variant))||(raw.experiment_id==='diag-next-step-v1'&&['control','personalized'].includes(raw.experiment_variant))){out.experiment_id=raw.experiment_id;out.experiment_variant=raw.experiment_variant;}
 return out;
}
export function saveOfferContext(storage,raw,now=Date.now()){
 const clean=offerAttribution(raw);if(!Object.keys(clean).length)return;
 try{storage.setItem(OFFER_KEY,JSON.stringify({at:now,...clean}));}catch{}
}
export function readOfferContext(storage,now=Date.now()){
 try{const raw=JSON.parse(storage.getItem(OFFER_KEY)||'null');if(!raw||!Number.isFinite(raw.at)||now<raw.at||now-raw.at>30*60000)return {};return offerAttribution(raw);}catch{return {};}
}

/** An explicit new placement replaces the prior experiment, even if reporting is offline. */
export function checkoutOfferContext(server={},stored={}){
 const clean=offerAttribution(stored);return Object.keys(clean).length?clean:offerAttribution(server);
}
