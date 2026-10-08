import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,fetchList} from './business-metrics.mjs';
const meta={billingSchema:'1',firebaseUid:'private-user'};
test('paid purchases, recurring list price, cancellation and cash have separate denominators',()=>{
 const report=summarize({start:1,end:100,prices:{monthly:{id:'pm'},annual:{id:'pa'}},sessions:[{livemode:true,metadata:meta,status:'complete',payment_status:'paid',mode:'subscription',subscription:'sub',currency:'usd',amount_total:700},{livemode:true,metadata:{...meta,plan:'lifetime'},status:'complete',payment_status:'paid',mode:'payment',currency:'usd',amount_total:2900},{status:'open',payment_status:'unpaid'}],subscriptions:[{id:'sub',livemode:true,metadata:meta,status:'active',cancel_at_period_end:true,items:{data:[{quantity:1,price:{id:'pm',currency:'usd',unit_amount:700,recurring:{interval:'month',interval_count:1}}}]}},{id:'annual',livemode:true,metadata:meta,status:'active',items:{data:[{quantity:1,price:{id:'pa',currency:'usd',unit_amount:4800,recurring:{interval:'year',interval_count:1}}}]}}],charges:[{livemode:true,paid:true,captured:true,currency:'usd',amount:700}],refunds:[{status:'succeeded',currency:'usd',amount:200},{status:'pending',currency:'usd',amount:500}]});
 assert.deepEqual(report.currentOffer.paidCheckoutPurchases,{monthly:1,annual:0,lifetime:1,unclassified:0});
 assert.equal(report.currentOffer.recurringListPriceMonthlyMinor.usd,1100);
 assert.equal(report.currentOffer.scheduledCancellationMonthlyMinor.usd,700);
 assert.equal(report.accountWideCash.refundedMinor.usd,200);
 assert.ok(!JSON.stringify(report).includes('private-user'));
});
test('pagination completes or fails loudly without partial report',async()=>{
 let calls=0;const get=async()=>++calls===1?{data:[{id:'first'}],has_more:true}:{data:[{id:'last'}],has_more:false};
 assert.equal((await fetchList(get,'/list')).length,2);
 await assert.rejects(fetchList(async()=>({data:[{id:'first'}],has_more:true}),'/list',{},1),/limit_exceeded/);
});
test('owner checks segregate paid production sessions without printing emails',async()=>{
 const {checkoutOwnership}=await import('./business-metrics.mjs');
 const base={livemode:true,metadata:{...meta,plan:'lifetime'},status:'complete',payment_status:'paid',mode:'payment',created:50};
 const result=checkoutOwnership([{...base,customer_details:{email:' OWNER@example.com '}},{...base,customer_email:'other@example.com'},base,{...base,livemode:false,customer_email:'owner@example.com'}],'owner@example.com');
 assert.deepEqual(result.counts,{ownerEmailMatch:1,otherEmail:1,unknownEmail:1});
 assert.ok(!JSON.stringify(result).includes('@'));
});
test('paid source breakdown uses allowlisted saved attribution and preserves unattributed sales',()=>{
 const base={livemode:true,metadata:{...meta,plan:'lifetime'},status:'complete',payment_status:'paid',mode:'payment',currency:'usd',amount_total:2900};
 const report=summarize({start:1,end:100,prices:{},subscriptions:[],charges:[],refunds:[],sessions:[{...base,metadata:{...base.metadata,mp_source:'google',mp_medium:'organic',mp_ui_locale:'en'}},base,{...base,metadata:{...base.metadata,mp_source:'private@example.com',mp_medium:'organic',mp_ui_locale:'en'}}]});
 assert.deepEqual(report.currentOffer.paidCheckoutBySource,{google:{purchases:1,grossMinor:{usd:2900}},unattributed:{purchases:2,grossMinor:{usd:5800}}});
 assert.ok(!JSON.stringify(report).includes('private@example.com'));
});

test('landing purchase groups separate unknown history and never manufacture conversion rates',()=>{
 const base={livemode:true,metadata:{...meta,plan:'lifetime',mp_source:'google',mp_medium:'organic',mp_ui_locale:'en'},status:'complete',payment_status:'paid',mode:'payment',currency:'usd',amount_total:2900};
 const report=summarize({start:1,end:100,prices:{},subscriptions:[],charges:[],refunds:[],sessions:[{...base,metadata:{...base.metadata,mp_landing_page:'/learn/fr-u-y'}},base,{...base,metadata:{...base.metadata,mp_landing_page:'/account/private'}}]});
 assert.deepEqual(report.currentOffer.paidCheckoutByLandingPage,{'/learn/fr-u-y':{purchases:1,grossMinor:{usd:2900}},unattributed:{purchases:2,grossMinor:{usd:5800}}});
 assert.ok(!JSON.stringify(report.currentOffer).includes('private'));
});
