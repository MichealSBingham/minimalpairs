import test from 'node:test'; import assert from 'node:assert/strict'; import {planNext} from './eligibility.mjs';
const subscriber={id:'test', enrollmentId:'one', subscribed:true, hasPaidAccess:false, courseConsentAt:'2026-10-01T00:00:00Z'};
const base={subscriber,now:Date.parse('2026-10-08T00:00:00Z'),active:true};
test('off by default, no accidental campaign activation',()=>assert.equal(planNext({...base,active:undefined}).eligible,false));
test('account creation is not course consent',()=>assert.equal(planNext({...base,subscriber:{...subscriber,courseConsentAt:null}}).eligible,false));
test('all suppression reasons block',()=>{for(const key of ['unsubscribed','bounced','complained','suppressed'])assert.equal(planNext({...base,subscriber:{...subscriber,[key]:true}}).eligible,false)});
test('late enrollment processing never skips initial lesson',()=>assert.equal(planNext(base).step,'day0'));
test('all marketing sends enforce spacing',()=>assert.equal(planNext({...base,sent:[{subscriberId:'test',sentAt:'2026-10-07T00:00:00Z',step:'newsletter'}]}).reason,'48-hour-spacing'));
const sent=['day0','day3'].map((step,i)=>({subscriberId:'test',enrollmentId:'one',step,sentAt:`2026-10-0${i?4:1}T00:00:00Z`}));
test('paid members never receive upgrade variant',()=>assert.equal(planNext({...base,sent,subscriber:{...subscriber,hasPaidAccess:true}}).includeUpgrade,false));
test('free final email can include offer and uses stable idempotency key',()=>{const a=planNext({...base,sent});assert.equal(a.includeUpgrade,true);assert.equal(a.idempotencyKey,planNext({...base,sent}).idempotencyKey)});
test('completed course stops',()=>assert.equal(planNext({...base,now:Date.parse('2026-10-11'),sent:[...sent,{subscriberId:'test',enrollmentId:'one',step:'day7',sentAt:'2026-10-08'}]}).reason,'course-complete'));

test('unknown entitlement never creates an upgrade pitch',()=>{const result=planNext({...base,sent,subscriber:{...subscriber,hasPaidAccess:undefined}});assert.equal(result.includeUpgrade,false);assert.equal(result.variant,'neutral')});
test('invalid receipt timestamp fails closed',()=>assert.equal(planNext({...base,sent:[{subscriberId:'test',sentAt:'invalid',step:'day0'}]}).reason,'invalid-send-receipt'));
