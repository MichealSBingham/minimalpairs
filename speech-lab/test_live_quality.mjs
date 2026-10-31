import assert from 'node:assert/strict';
import {BackgroundGuard} from './speaking/live-quality.mjs';
const voice={ok:true,rms:.1,periodicity:.98,f1:350,f2:2200};
let g=new BackgroundGuard();
assert.equal(g.apply(voice,0).ok,true); // No invented baseline or opening block.
assert.equal(g.floor,null);
for(let t=40;t<=600;t+=40)g.apply({ok:false,rms:.03,periodicity:.1},t);
assert.equal(g.floor,.03);
assert.equal(g.apply(voice,640).ok,false); // Too close to observed background.
assert.match(g.apply(voice,680).reason,/background/);
for(let t=720;t<=1360;t+=40)g.apply({ok:false,rms:.00001},t);
assert.equal(g.apply(voice,1400).ok,true); // A quieter room can recover.
g=new BackgroundGuard();
for(let t=0;t<=1000;t+=40)g.apply(voice,t);
assert.equal(g.floor,null); // Do not learn a held vowel as the background.
g=new BackgroundGuard();
for(let t=0;t<=200;t+=40)g.apply({ok:false,rms:.1,periodicity:.1},t);
assert.equal(g.apply(voice,240).ok,true); // Short fricative cannot become baseline.
assert.equal(g.floor,null);
assert.equal(g.apply({ok:false,rms:.1,periodicity:.2},280).ok,false); // Never upgrades rejection.
console.log('Background guard: 10 behavioral assertions passed.');
