import test from 'node:test';
import assert from 'node:assert/strict';
import {marketQuote,marketParameters,validRegionalCoverage,regionalOffer} from './markets.mjs';
const config={regionalPricingEnabled:true,regionalOffers:{middle:{amount:1900,couponId:'mid'},value:{amount:1450,couponId:'val'}}};
test('countries select stable prices; missing and affluent markets retain standard',()=>{
 for(const c of ['US','FR','JP','DE','GB',null,'bad'])assert.equal(marketQuote(config,c).lifetime,2900);
 for(const c of ['ES','PT','TW','PL'])assert.equal(marketQuote(config,c).lifetime,1900);
 for(const c of ['BR','TR','IN','MX'])assert.equal(marketQuote(config,c).lifetime,1450);
 assert.equal(marketQuote({...config,regionalPricingEnabled:false},'BR').lifetime,2900);
});
test('discount binding requires exact country tier amount and coupon',()=>{
 const p=marketParameters({mode:'payment',metadata:{plan:'lifetime'}},config,'BR');
 assert.deepEqual(p.discounts,[{coupon:'val'}]);assert.equal(p.metadata.market_amount,'1450');
 const snapshot={amountPaid:1450,regionalCouponId:'val',regionalMetadata:p.metadata};
 assert.ok(validRegionalCoverage(snapshot,config));
 assert.ok(validRegionalCoverage(snapshot,{...config,regionalPricingEnabled:false}),'previous payments survive rollback');
 assert.equal(validRegionalCoverage({...snapshot,amountPaid:1},config),false);
 assert.equal(validRegionalCoverage({...snapshot,regionalCouponId:'wrong'},config),false);
 assert.equal(regionalOffer(config,{...p.metadata,market_country:'US'}),null);
});
test('monthly stays unchanged; standard has no coupon',()=>{
 assert.equal(marketParameters({mode:'subscription',metadata:{}},config,'BR').discounts,undefined);
 assert.equal(marketParameters({mode:'payment',metadata:{}},config,'US').discounts,undefined);
});
