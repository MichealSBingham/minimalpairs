import test from 'node:test';import assert from 'node:assert/strict';import {purchaseFeed} from './purchase-feed.mjs';
const now=Date.now(),to=Math.floor(now/1000),env={PURCHASE_FEED_TOKEN:'scoped',STRIPE_SECRET_KEY:'existing-in-billing'};
const req=(auth='scoped')=>new Request(`https://internal/internal/buyer-events?created_gte=${to-86400}&created_lte=${to}`,{headers:{Authorization:'Bearer '+auth}});
test('feed never exposes arbitrary Stripe endpoints or unverified customer records',async()=>{
 assert.equal((await purchaseFeed(req('wrong'),env)).status,401);
 const r=await purchaseFeed(req(),env,{now,fetcher:async(url,options)=>{assert.equal(url.pathname,'/v1/events');assert.equal(options.headers.Authorization,'Bearer existing-in-billing');return Response.json({has_more:true,data:[{id:'evt_bad',livemode:false,data:{object:{customer_email:'secret@example.com'}}},{id:'evt_paid',livemode:true,created:to,data:{object:{id:'cs_live_123',livemode:true,status:'complete',payment_status:'paid',amount_total:2900,currency:'usd',created:to-30,mode:'payment',metadata:{billingSchema:'1',firebaseUid:'private-uid',plan:'lifetime',mp_source:'google'},customer_details:{email:'buyer@example.com',address:{private:'hidden'}},customer:'private-customer'}}}]});}});
 const d=await r.json();assert.equal(d.data[0].data.object,null);assert.equal(d.data[1].data.object.metadata.firebaseUid,'verified');assert.equal(d.data[1].data.object.paid_event_at,to);assert.doesNotMatch(JSON.stringify(d),/private-uid|private-customer|hidden|secret@example/);assert.equal(d.has_more,true);
});
