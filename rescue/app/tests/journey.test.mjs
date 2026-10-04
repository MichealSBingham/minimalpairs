import test from 'node:test';
import assert from 'node:assert/strict';
import {journeyStats, selectJourneyContrasts} from '../src/lib/journey.ts';
const contrasts=Array.from({length:8},(_,i)=>({id:`c${i}`,pairs:[]}));
const record=(contrastId,correct=9,total=12,other={})=>({id:`focused-${contrastId}`,languageId:'en',contrastId,correct,total,textHintsUsed:false,audioCollectionId:'chatterbox-us-four-voices-v1',...other});
test('every mode respects free access, including a locked selection',()=>{
 assert.deepEqual(selectJourneyContrasts(contrasts,[],'en',false,'focused','c5'),[]);
 for(const mode of ['mixed','diagnostic'])assert.deepEqual(selectJourneyContrasts(contrasts,[],'en',false,mode,'c5').map(c=>c.id),['c0','c1','c2']);
 assert.equal(selectJourneyContrasts(contrasts,[],'en',true,'diagnostic','c0').length,8);
});
test('mixed review selects untried sounds first then lower performance',()=>{
 const sessions=contrasts.slice(0,7).map((c,i)=>record(c.id,i+2));
 assert.deepEqual(selectJourneyContrasts(contrasts,sessions,'en',true,'mixed','c0').map(c=>c.id),['c7','c0','c1']);
});
test('diagnostic, hinted, other-language and experimental history cannot mark lessons practiced',()=>{
 const sessions=[record('c0',4,4,{id:'diagnostic-c0'}),record('c1',12,12,{textHintsUsed:true}),record('c2',12,12,{languageId:'fr'}),record('c3',12,12,{audioCollectionId:'human-library-v1'}),record('c4')];
 assert.deepEqual(journeyStats(contrasts,sessions,'en').filter(s=>s.practiced).map(s=>s.contrast.id),['c4']);
 assert.equal(journeyStats(contrasts,sessions,'en')[0].rate,1);
});
