import test from 'node:test';
import assert from 'node:assert/strict';
import {offerAttribution,saveOfferContext,readOfferContext,OFFER_KEY,checkoutOfferContext} from '../src/lib/offer-attribution.mjs';
import {attributionMetadata,attributionFromMetadata} from '../../billing/analytics.mjs';
import {plausibleProperties} from '../src/lib/plausible-events.mjs';
const labels={experiment_id:'diag-paywall-v1',experiment_variant:'paid',offer_placement:'diagnostic-report'};
test('offer survives same-tab sign-in and Stripe metadata roundtrip without arbitrary fields',()=>{
 const m=new Map(),s={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};
 saveOfferContext(s,{...labels,email:'secret@example.test',attempt_id:'private'},1000);
 assert.deepEqual(readOfferContext(s,2000),labels);
 const metadata=attributionMetadata({source:'google',medium:'organic',ui_locale:'en',...readOfferContext(s,2000)});
 assert.equal(metadata.mp_experiment_variant,'paid');assert.equal(attributionFromMetadata(metadata).offer_placement,'diagnostic-report');
 assert.deepEqual(plausibleProperties({...labels,email:'secret@example.test'}),labels);
 assert.ok(!m.get(OFFER_KEY).includes('secret'));assert.deepEqual(readOfferContext(s,31*60000),{});
});
test('invalid labels are stripped and storage failures never throw',()=>{
 assert.deepEqual(offerAttribution({experiment_id:'bad',experiment_variant:'paid',offer_placement:'email@example.test'}),{});
 const broken={getItem(){throw Error()},setItem(){throw Error()}};
 assert.doesNotThrow(()=>saveOfferContext(broken,labels));assert.deepEqual(readOfferContext(broken),{});
});
test('new non-experiment offer does not inherit an old diagnostic assignment',()=>{
 const m=new Map(),s={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};saveOfferContext(s,labels,1);saveOfferContext(s,{offer_placement:'post-lesson'},2);assert.deepEqual(readOfferContext(s,3),{offer_placement:'post-lesson'});
});

test('explicit nonexperiment placement clears stale server experiment even when reporting fails',()=>{
 assert.deepEqual(checkoutOfferContext(labels,{offer_placement:'post-lesson'}),{offer_placement:'post-lesson'});
 assert.deepEqual(checkoutOfferContext(labels,{offer_placement:'locked-lesson'}),{offer_placement:'locked-lesson'});
});
