import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {privateJson,privateDirectory} from './runtime-sandbox-state.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), dir=path.join(root,'private');
const project='minimalpairs', email=`minimalpairs-billing@${project}.iam.gserviceaccount.com`,file=path.join(dir,'production-identity.json');
const require=createRequire(import.meta.url);
const write=(file,data)=>{const temp=`${file}.tmp`;fs.writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(temp,file);};
async function main(){
 assert.equal(process.argv[2],'--prepare');assert.equal(process.argv.length,3);privateDirectory(dir);
 const lock=fs.openSync(path.join(dir,'production-identity.lock'),'wx',0o600);
 try {
  const auth=require(path.resolve(root,'../app/node_modules/firebase-tools/lib/auth.js'));
  const owner=auth.getProjectDefaultAccount(path.resolve(root,'../app'));assert.ok(owner?.tokens?.refresh_token);
  const access=await auth.getAccessToken(owner.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
  async function google(endpoint,method='GET',body){
   const response=await fetch(`https://iam.googleapis.com/v1/${endpoint}`,{method,redirect:'error',headers:{Authorization:`Bearer ${access.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw new Error(`production_iam_http_${response.status}`);return response.json();
  }
  const accountPath=`projects/${project}/serviceAccounts/${email}`;
  const account=await google(accountPath);assert.equal(account.email,email);assert.equal(account.disabled??false,false);
  const state=fs.existsSync(file)?privateJson(file):{project,email};assert.equal(state.email,email);assert.equal(state.project,project);
  if(!state.credentials){
   assert.ok(!state.keyAttemptAt,'uncertain_key_creation_requires_readback');
   const keys=await google(`${accountPath}/keys?keyTypes=USER_MANAGED`);assert.equal(keys.keys?.length||0,0,'unexpected_existing_keys');
   state.keyAttemptAt=Date.now();write(file,state);
   const key=await google(`${accountPath}/keys`,'POST',{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});
   state.keyName=key.name;state.credentials=JSON.parse(Buffer.from(key.privateKeyData,'base64').toString('utf8'));write(file,state);
  }
  assert.equal(state.credentials.client_email,email);assert.equal(state.credentials.project_id,project);
  const setup=privateJson(path.join(dir,'production-setup.json')),stripe=privateJson(path.join(dir,'stripe-production.json'));
  assert.equal(setup.accountId,'acct_1PFMIDJ2FK64SYOd');assert.equal(stripe.accountId,setup.accountId);assert.equal(setup.config.expectedLivemode,true);
  const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  config.name='minimalpairs-billing';config.main=path.join(root,'runtime/worker.mjs');config.workers_dev=true;config.preview_urls=false;
  config.vars.BILLING_CONFIG_JSON=JSON.stringify(setup.config);
  config.vars.BILLING_SERVICE_ENABLED='true';config.vars.BILLING_CHECKOUT_ENABLED='false';config.vars.BILLING_COMMUNICATIONS_APPROVED='true';
  write(path.join(dir,'wrangler.production.json'),config);
  write(path.join(dir,'production-secrets.json'),{STRIPE_SECRET_KEY:stripe.secretKey,STRIPE_ACCOUNT_ID:stripe.accountId,STRIPE_WEBHOOK_SECRETS_JSON:JSON.stringify([setup.operations.webhook.result.secret]),FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(state.credentials)});
  console.log(JSON.stringify({prepared:true,project,serviceAccount:email,worker:config.name,checkoutEnabled:false,secretsLogged:false}));
 }finally{fs.closeSync(lock);fs.unlinkSync(path.join(dir,'production-identity.lock'));}
}
main().catch(e=>{console.error(JSON.stringify({error:/^production_iam_http_\d+$/.test(e.message)?e.message:'production_runtime_preparation_failed',note:'Inspect the private checkpoint before retrying.'}));process.exitCode=1;});
