// Server-selected regional lifetime offers. Country comes from Cloudflare, never the client body.
export const MARKET_VERSION = 'regional-v1';
const VALUE = new Set('BR TR IN ID PH VN TH MY MX CO PE AR EG ZA PK BD NG UA'.split(' '));
const MID = new Set('ES PT PL RO BG HU GR CZ SK HR CL CR CN TW'.split(' '));
export function marketQuote(config, country) {
  country = /^[A-Z]{2}$/.test(country || '') ? country : 'XX';
  const tier = config.regionalPricingEnabled ? VALUE.has(country) ? 'value' : MID.has(country) ? 'middle' : 'standard' : 'standard';
  const offer = config.regionalOffers?.[tier];
  return {version:MARKET_VERSION,country,tier:offer ? tier : 'standard',currency:'usd',lifetime:offer?.amount ?? 2900,monthly:700};
}
export function regionalOffer(config, metadata) {
  if(metadata?.market_version !== MARKET_VERSION) return null;
  const quote = marketQuote({...config,regionalPricingEnabled:true},metadata.market_country);
  const offer = config.regionalOffers?.[metadata.market_tier];
  return offer && quote.tier === metadata.market_tier && quote.lifetime === offer.amount ? offer : null;
}
export function marketParameters(parameters, config, country) {
  if(!config.regionalPricingEnabled)return parameters;
  const q = marketQuote(config,country);
  const metadata = {...parameters.metadata,market_version:q.version,market_country:q.country,market_tier:q.tier,market_amount:String(parameters.mode === 'payment' ? q.lifetime : q.monthly)};
  const offer = parameters.mode === 'payment' ? regionalOffer(config,metadata) : null;
  return {...parameters,metadata,...(offer?{discounts:[{coupon:offer.couponId}]}:{})};
}
export function validRegionalCoverage(snapshot,config) {
  const offer = regionalOffer(config,snapshot.regionalMetadata);
  return !!offer && snapshot.regionalCouponId === offer.couponId && snapshot.amountPaid === offer.amount;
}

// Individually authorized service-recovery offers. Never selected by a client price.
export function supportOffer(config, metadata) {
 const offer=config.supportOffers?.[metadata?.support_offer];
 return offer && offer.uid === metadata.firebaseUid && Number.isSafeInteger(offer.amount) && offer.amount>0 && offer.amount<2900 && typeof offer.couponId==='string' ? offer : null;
}
export function validSupportCoverage(snapshot,config) {
 const offer=supportOffer(config,snapshot.supportMetadata);
 return !!offer && offer.uid === snapshot.uid && snapshot.supportCouponId === offer.couponId && snapshot.amountPaid === offer.amount;
}
