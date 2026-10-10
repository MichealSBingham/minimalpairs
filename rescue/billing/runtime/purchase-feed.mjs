/** Narrow internal feed. The Stripe credential never leaves the billing service. */
export async function purchaseFeed(request,env,{fetcher=fetch,now=Date.now()}={}){
 if(!env.PURCHASE_FEED_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.PURCHASE_FEED_TOKEN)return new Response(null,{status:401});
 if(request.method!=='GET')return new Response(null,{status:405});
 const q=new URL(request.url).searchParams,from=Number(q.get('created_gte')),to=Number(q.get('created_lte')),cursor=q.get('starting_after');
 if([...q.keys()].some(k=>!['created_gte','created_lte','starting_after'].includes(k))||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<Math.floor(now/1000)-31*86400||to<from||to>Math.floor(now/1000)+60||(cursor&&!/^evt_[A-Za-z0-9]+$/.test(cursor)))return new Response(null,{status:400});
 const url=new URL('https://api.stripe.com/v1/events');url.searchParams.set('limit','100');url.searchParams.set('created[gte]',String(from));url.searchParams.set('created[lte]',String(to));for(const type of ['checkout.session.completed','checkout.session.async_payment_succeeded'])url.searchParams.append('types[]',type);if(cursor)url.searchParams.set('starting_after',cursor);
 const r=await fetcher(url,{headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY}});if(!r.ok)return Response.json({error:'purchase_feed_unavailable'},{status:502});
 const body=await r.json();if(!Array.isArray(body.data))return new Response(null,{status:502});
 // Preserve every event ID for pagination; unpaid/unrelated events carry no customer payload.
 const data=body.data.map(e=>{const s=e.data?.object;if(!e.livemode||s?.livemode!==true||s.status!=='complete'||s.payment_status!=='paid'||s.metadata?.billingSchema!=='1'||!s.metadata.firebaseUid)return {id:e.id,data:{object:null}};
 const metadata={billingSchema:'1',firebaseUid:'verified',...(s.metadata.plan?{plan:s.metadata.plan}:{})};for(const k of ['journey','source','medium','campaign','ui_locale','landing_page','language','contrast','session_kind','surface'])if(typeof s.metadata['mp_'+k]==='string')metadata['mp_'+k]=s.metadata['mp_'+k].slice(0,500);
 return {id:e.id,data:{object:{id:s.id,livemode:true,status:s.status,payment_status:s.payment_status,amount_total:s.amount_total,currency:s.currency,created:s.created,paid_event_at:e.created,mode:s.mode,metadata,customer_email:s.customer_details?.email||s.customer_email||null}}};});
 return Response.json({data,has_more:body.has_more===true},{headers:{'Cache-Control':'no-store'}});
}
