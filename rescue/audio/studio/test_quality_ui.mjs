import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const script=fs.readFileSync(new URL('./quality.html',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0];
const clip=(id='a',sha='one')=>({id,sha,bank:'en-US-ga',text:'cheap',ipa:'/tʃiːp/',voice:'A',review:'unreviewed',flags:[],nextReview:true});
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(post){
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,hidden:false,paused:true,append(){},pause(){},play:async()=>{},click(){this.onclick?.({detail:1});}});return elements.get(id);};
 const calls=[];let rows=[clip(),clip('b')];let token='new';
 const fetch=async(url,init)=>{calls.push({url,init});return url==='/api/queue'?{ok:true,json:async()=>({sessionToken:token,clips:structuredClone(rows)})}:post(init);};
 const context=vm.createContext({document:{getElementById:element,createElement:()=>({}),addEventListener(){},hidden:false},window:{addEventListener(){}},location:{search:'?scope=followup'},URLSearchParams,AbortSignal,setInterval(){},fetch,console});vm.runInContext(script,context);await tick();await tick();
 return {context,element,calls,setRows(v){rows=v;},run:s=>vm.runInContext(s,context)};
}
test('does not advance or accept duplicate action before confirmed save; blocks filter changes',async()=>{
 let resolve;const f=await fixture(()=>new Promise(r=>resolve=r));const p=f.run("decide('reject')");
 assert.equal(f.element('bank').disabled,true);assert.equal(f.run('current.id'),'a');
 await f.run("decide('reject')");assert.equal(f.calls.filter(c=>c.url==='/api/decision').length,1);
 resolve({ok:true,status:200,json:async()=>({saved:true})});await p;assert.equal(f.run('current.id'),'b');assert.match(f.element('save-status').textContent,/Saved/);
});
test('failed or unconfirmed save stays on same clip and displays visible failure',async()=>{
 for(const response of [{ok:false,status:500},{ok:true,status:200,json:async()=>({saved:false})}]){
 const f=await fixture(async()=>response);await f.run("decide('reject')");assert.equal(f.run('current.id'),'a');assert.equal(f.run('current.review'),'unreviewed');assert.match(f.element('save-status').textContent,/Not confirmed/);}
});
test('server restart token is renewed and same hash retried once',async()=>{
 let n=0;const f=await fixture(async()=>++n===1?{ok:false,status:403}:{ok:true,status:200,json:async()=>({saved:true})});await f.run("decide('reject')");assert.equal(n,2);assert.equal(f.run('current.id'),'b');
});
test('changed recording is never approved using old hash',async()=>{
 let n=0;const f=await fixture(async()=>{n++;return {ok:false,status:403};});f.setRows([clip('a','replacement')]);await f.run("decide('reject')");assert.equal(n,1);assert.match(f.element('message').textContent,/replaced/);assert.equal(f.run('current.sha'),'one');
});
test('sync keeps listening progress for unchanged clip and refreshes replaced clip',async()=>{
 const f=await fixture(async()=>({ok:true,json:async()=>({saved:true})}));f.run('heard=true;covered=2');await f.run('syncQueue()');assert.equal(f.run('heard'),true);f.setRows([clip('a','new')]);await f.run('syncQueue()');assert.equal(f.run('current.sha'),'new');assert.equal(f.run('heard'),false);
});
