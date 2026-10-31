import test from 'node:test';
import assert from 'node:assert/strict';
import {saveCheckoutHandoff,takeCheckoutHandoff} from '../src/lib/checkout-handoff.mjs';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
test('explicit selection survives sign-in navigation exactly once with attribution',()=>{const s=storage();saveCheckoutHandoff(s,'lifetime',{attempt_id:'example'},100,'nonce');const q='?plan=lifetime&checkout_intent=nonce';assert.deepEqual(takeCheckoutHandoff(s,q,101),{plan:'lifetime',context:{attempt_id:'example'}});assert.equal(takeCheckoutHandoff(s,q,102),null);});
test('a plan URL alone, cancellation, mismatch and stale intent never continue checkout',()=>{for(const q of ['?plan=lifetime','?plan=monthly&checkout_intent=nonce','?plan=lifetime&checkout_intent=wrong','?plan=lifetime&checkout_intent=nonce&billing=cancel']){const s=storage();saveCheckoutHandoff(s,'lifetime',{},100,'nonce');assert.equal(takeCheckoutHandoff(s,q,101),null)}const s=storage();saveCheckoutHandoff(s,'lifetime',{},100,'nonce');assert.equal(takeCheckoutHandoff(s,'?plan=lifetime&checkout_intent=nonce',1000000),null);});
