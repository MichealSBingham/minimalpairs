import test from 'node:test';
import assert from 'node:assert/strict';
import {journeyStats, selectJourneyContrasts} from '../src/lib/journey.ts';
const contrasts=Array.from({length:8},(_,i)=>({id:`c${i}`,pairs:[]}));
const record=(contrastId,correct=9,total=12,other={})=>({id:`focused-${contrastId}`,languageId:'en',mode:'abx-cross-word',contrastId,correct,total,textHintsUsed:false,audioCollectionId:'chatterbox-us-four-voices-v1',...other});
test('diagnostic covers the full language while focused and mixed practice respect free access',()=>{
 assert.deepEqual(selectJourneyContrasts(contrasts,[],'en',false,'focused','c5'),[]);
 for(const mode of ['mixed'])assert.deepEqual(selectJourneyContrasts(contrasts,[],'en',false,mode,'c5').map(c=>c.id),['c0','c1','c2']);
 assert.equal(selectJourneyContrasts(contrasts,[],'en',false,'diagnostic','c0').length,8);
 assert.equal(selectJourneyContrasts(contrasts,[],'en',true,'diagnostic','c0').length,8);
});
test('mixed review selects untried sounds first then lower performance',()=>{
 const sessions=contrasts.slice(0,7).map((c,i)=>record(c.id,i+2));
 assert.deepEqual(selectJourneyContrasts(contrasts,sessions,'en',true,'mixed','c0').map(c=>c.id),['c7','c0','c1']);
});
test('diagnostic, hinted, other-language and experimental history cannot mark lessons practiced',()=>{
 const sessions=[record('c0',4,4,{id:'diagnostic-c0'}),record('c1',12,12,{textHintsUsed:true}),record('c2',12,12,{languageId:'fr'}),record('c3',12,12,{audioCollectionId:'human-library-v1'}),record('c4')];
 assert.deepEqual(journeyStats(contrasts,sessions,'en').filter(s=>s.practiced).map(s=>s.contrast.id),['c4']);
 assert.equal(journeyStats(contrasts,sessions,'en')[0].rate,null);
});

test('identification review uses its own scores rather than ABX scores',()=>{
 const sessions=contrasts.map(c=>record(c.id,12));
 assert.equal(journeyStats(contrasts,sessions,'en','word-identification')[0].total,0);
 const identification=record('c0',2,6,{mode:'word-identification',textHintsUsed:true});
 assert.equal(journeyStats(contrasts,[identification],'en','word-identification')[0].rate,1/3);
});
