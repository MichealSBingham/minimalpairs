import test from 'node:test';
import assert from 'node:assert/strict';
test('course report excludes subscriber addresses and surfaces uncertain delivery',async()=>{
 const oldFetch=globalThis.fetch,oldLog=console.log;let result;
 const oldOrigin=process.env.EMAIL_SERVICE_ORIGIN,oldToken=process.env.EMAIL_ADMIN_TOKEN;
 process.env.EMAIL_SERVICE_ORIGIN='https://example.test';process.env.EMAIL_ADMIN_TOKEN='test';
 globalThis.fetch=async url=>new Response(JSON.stringify(String(url).endsWith('/subscribers')?{subscribers:[{email:'private@example.test',status:'subscribed',language:'fr',course:true,weekly:true,attribution:{source:'google'}}]}:{intakeEnabled:true,sendingEnabled:true,outbox:{accepted:2,uncertain:1},buyers:{states:{uncertain:1},collector:{state:'current',checkedAt:Date.now()}}}),{status:200});
 console.log=value=>{result=JSON.parse(value)};
 try{await import('./fetch-course-status.mjs');assert.equal(result.subscribers.total,1);assert.equal(result.subscribers.attributionAvailable,1);assert.equal(JSON.stringify(result).includes('private@example.test'),false);assert.equal(result.actions.length,2);}
 finally{globalThis.fetch=oldFetch;console.log=oldLog;if(oldOrigin===undefined)delete process.env.EMAIL_SERVICE_ORIGIN;else process.env.EMAIL_SERVICE_ORIGIN=oldOrigin;if(oldToken===undefined)delete process.env.EMAIL_ADMIN_TOKEN;else process.env.EMAIL_ADMIN_TOKEN=oldToken;}
});
