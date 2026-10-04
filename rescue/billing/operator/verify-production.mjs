// Production smoke checks stop before payment. Never charge or refund.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {privateJson} from './runtime-sandbox-state.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=path.join(root,'private'),file=path.join(dir,'production-smoke.json');
const require=createRequire(import.meta.url);const mode=process.argv[2];assert.ok(['--identity','--checkout','--cleanup'].includes(mode));
async function main(){
 const state=fs.existsSync(file)?privateJson(file):{uid:`launch_${randomUUID().replaceAll('-','')}`,password:randomBytes(32).toString('base64url'),requestId:randomUUID()};
 state.email??=`${state.uid}@example.invalid`;
 const save=()=>{fs.writeFileSync(file,JSON.stringify(state),{mode:0o600});};
 const auth=require(path.join(root,'../app/node_modules/firebase-tools/lib/auth.js'));const owner=auth.getProjectDefaultAccount(path.join(root,'../app'));const access=await auth.getAccessToken(owner.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
 const apiKey=fs.readFileSync(path.join(root,'../app/.env'),'utf8').match(/^PUBLIC_FIREBASE_API_KEY=(.+)$/m)[1].trim();
 async function identity(action,body,admin=true){const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}${admin?'':`?key=${encodeURIComponent(apiKey)}`}`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(admin?{Authorization:`Bearer ${access.access_token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`identity_http_${r.status}`);return r.json();}
 const lookup=()=>identity('lookup',{targetProjectId:'minimalpairs',localId:[state.uid]});
 if(mode==='--cleanup'){
  const current=(await lookup()).users?.[0];if(current){assert.equal(current.email,state.email);await identity('update',{targetProjectId:'minimalpairs',localId:state.uid,disableUser:true});}
  state.disabled=true;delete state.password;delete state.idToken;save();console.log('PASS synthetic account disabled; no payments made');return;
 }
 assert.ok(!state.disabled);
 if(!state.created){save();const prior=(await lookup()).users?.[0];if(!prior)await identity('signUp',{targetProjectId:'minimalpairs',localId:state.uid,email:state.email,password:state.password,emailVerified:true});else assert.equal(prior.email,state.email);state.created=true;save();}
 const session=await identity('signInWithPassword',{email:state.email,password:state.password,returnSecureToken:true},false);assert.equal(session.localId,state.uid);state.idToken=session.idToken;save();
 const setup=privateJson(path.join(dir,'production-setup.json'));
 async function worker(endpoint,body,origin=setup.config.appOrigin,token=state.idToken){const r=await fetch(`${setup.workerOrigin}/billing/${endpoint}`,{method:'POST',redirect:'error',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});return {status:r.status,data:await r.json(),cors:r.headers.get('access-control-allow-origin')};}
 const wrong=await worker('checkout-status',{},'https://example.invalid');assert.equal(wrong.status,403);
 const missing=await worker('checkout-status',{},setup.config.appOrigin,null);assert.equal(missing.status,401);
 const status=await worker('checkout-status',{});assert.equal(status.status,200,`authenticated_status_${status.status}_${status.data.error}`);assert.equal(status.cors,setup.config.appOrigin);
 if(mode==='--identity'){console.log('PASS deployed production identity, CORS and missing-token rejection');return;}
 const results=await Promise.all([worker('checkout',{plan:'monthly',requestId:state.requestId}),worker('checkout',{plan:'monthly',requestId:state.requestId})]);
 for(const r of results){assert.equal(r.status,200,`checkout_${r.status}_${r.data.error}`);assert.equal(new URL(r.data.url).origin,'https://checkout.stripe.com');}
 assert.equal(results[0].data.url,results[1].data.url);state.checkoutUrl=results[0].data.url;save();
 const portal=await worker('portal',{});assert.equal(portal.status,200,`portal_${portal.status}_${portal.data.error}`);assert.equal(new URL(portal.data.url).origin,'https://billing.stripe.com');
 console.log('PASS live checkout created, concurrent requests deduplicated, portal available; no payment submitted');
}
main().catch(e=>{console.error(String(e.message).replace(/(?:rk|sk)_live_\w+/g,'[redacted]'));process.exitCode=1;});
