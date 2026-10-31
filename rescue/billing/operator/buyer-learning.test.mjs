import test from 'node:test';import assert from 'node:assert/strict';import {usableRecoveryReservation as valid} from './buyer-learning.mjs';
test('recovery attribution cannot use another account, future or stale reservation',()=>{
 const s={created:100000,metadata:{support_offer:'support',firebaseUid:'owner'}},r={found:true,createdAt:99900,metadata:{firebaseUid:'owner'}};
 assert.equal(valid(s,r),true);assert.equal(valid(s,{...r,createdAt:100001}),false);assert.equal(valid(s,{...r,createdAt:1}),false);assert.equal(valid(s,{...r,metadata:{firebaseUid:'other'}}),false);assert.equal(valid({...s,metadata:{firebaseUid:'owner'}},r),false);
});
