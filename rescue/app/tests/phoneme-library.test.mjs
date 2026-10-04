import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPhonemeLibrary, getPhonemeLibrary, attachTextBankRelease } from '../src/lib/phoneme-library.ts';

const fixture = () => [{ languageIds:['en'], searchedAt:'2026-10-01', searchLog:[], gaps:[], sources:[
  {id:'study',title:'A study',url:'https://example.org/study',kind:'stimulus-list',locator:'Table 1',whatItSupports:'Listed words only',limitations:'IPA is editorial'},
  {id:'dictionary',title:'A dictionary',url:'https://example.org/dictionary',kind:'dictionary',locator:'Headwords',whatItSupports:'Pronunciation',limitations:'Dialect-specific'},
], contrasts:[{
  id:'en-fixture',languageId:'en',dialect:'Selected dialect',label:'Sound categories',categories:[{label:'p',ipa:'p'},{label:'b',ipa:'b'}],evidenceLevel:'study-stimuli',sourceIds:['study'],learnerL1s:['Example'],rationale:'Test',contextNotes:[],reviewNotes:[],status:'draft',
  pools:[['pat','pin'].map(text=>({text,ipa:`/${text}/`,meaning:text,position:'initial',group:'initial',sourceIds:['dictionary'],stimulusSourceIds:['study']})),['bat','bin'].map(text=>({text,ipa:`/${text}/`,meaning:text,position:'initial',group:'initial',sourceIds:['dictionary'],stimulusSourceIds:[]}))],minimalPairs:[{left:'pat',right:'bat',sourceIds:['dictionary']}],
}] }];

test('normalizes lexemes separately from category membership and minimal-pair links',()=>{
  const input=fixture(); const before=structuredClone(input); const lib=buildPhonemeLibrary(input);
  assert.deepEqual(input,before); assert.equal(lib.counts.uniqueWords,4); assert.equal(lib.counts.memberships,4);
  assert.equal(lib.counts.documentedStimulusMemberships,2); assert.equal(lib.contrasts[0].minimalPairs.length,1);
  assert.deepEqual(lib.contrasts[0].contextGroups,[{id:'initial',counts:[2,2],distinctPronunciations:[2,2],positions:['initial'],hasCrossWordCapacity:true,meetsMinimumDepth:false,meetsTargetDepth:false}]);
  assert.equal(lib.words[lib.contrasts[0].minimalPairs[0].leftWordId].text,'pat');
  assert.deepEqual(buildPhonemeLibrary(input),lib);
});

test('lexemes deduplicate across contrasts but category-review identities stay separate',()=>{
  const input=fixture(); const next=structuredClone(input[0].contrasts[0]); next.id='en-other'; input[0].contrasts.push(next);
  const lib=buildPhonemeLibrary(input); assert.equal(lib.counts.uniqueWords,4); assert.equal(lib.counts.memberships,8);
  assert.equal(lib.contrasts[0].pools[0][0].wordId,lib.contrasts[1].pools[0][0].wordId);
  assert.notEqual(lib.contrasts[0].pools[0][0].key,lib.contrasts[1].pools[0][0].key);
});

test('word, IPA, dialect, category and target-context changes invalidate the affected checks',()=>{
  const original=buildPhonemeLibrary(fixture());
  for(const mutate of [c=>c.pools[0][0].ipa='/changed/',c=>c.pools[0][0].meaning='new sense',c=>c.dialect='Other dialect',c=>c.categories[0].ipa='x',c=>c.pools[0][0].position='medial',c=>c.pools[0][0].group='new-group']){
    const input=fixture();mutate(input[0].contrasts[0]);const changed=buildPhonemeLibrary(input);
    assert.notEqual(changed.fingerprint,original.fingerprint);assert.notEqual(changed.contrasts[0].key,original.contrasts[0].key);assert.notEqual(changed.contrasts[0].pools[0][0].key,original.contrasts[0].pools[0][0].key);
  }
});

test('rejects broken source provenance, unresolved links, duplicate memberships and fabricated stimulus classifications',()=>{
  for(const mutate of [
    p=>p.contrasts[0].pools[0][0].sourceIds.push('absent'),p=>p.contrasts[0].minimalPairs[0].left='absent',
    p=>p.contrasts[0].pools[0].push(p.contrasts[0].pools[0][0]),p=>p.contrasts[0].pools[0][0].stimulusSourceIds=['dictionary'],
    p=>p.contrasts[0].pools.flat().forEach(w=>w.stimulusSourceIds=[]),p=>p.sources[0].url='javascript:alert(1)',
    p=>p.sources.push(p.sources[0]),p=>p.contrasts.push(p.contrasts[0]),
  ]){const input=fixture();mutate(input[0]);assert.throws(()=>buildPhonemeLibrary(input));}
});

test('an undersized context is not treated as cross-word ready',()=>{
  const input=fixture(); input[0].contrasts[0].pools[0][1].group='other';
  const c=buildPhonemeLibrary(input).contrasts[0];assert.ok(c.contextGroups.every(g=>!g.hasCrossWordCapacity));
});

test('overlapping spellings allow legal three-word trials without implying all combinations are valid',()=>{
  const input=fixture(),c=input[0].contrasts[0];c.minimalPairs=[];
  c.pools=c.pools.map((pool,side)=>['one','two','three'].map(text=>({...pool[0],text,ipa:`/${text}${side}/`})));
  assert.equal(buildPhonemeLibrary(input).contrasts[0].contextGroups[0].hasCrossWordCapacity,true);
  c.pools.forEach(pool=>pool.pop());
  assert.equal(buildPhonemeLibrary(input).contrasts[0].contextGroups[0].hasCrossWordCapacity,false);
});

test('a provenance correction reopens review and mixed positions do not pass the capacity check',()=>{
  const input=fixture(),before=buildPhonemeLibrary(input);input[0].sources[0].limitations='This list does not document these words.';
  const after=buildPhonemeLibrary(input);assert.notEqual(after.contrasts[0].key,before.contrasts[0].key);assert.notEqual(after.contrasts[0].pools[0][0].key,before.contrasts[0].pools[0][0].key);
  input[0].contrasts[0].pools[0][0].position='final';assert.equal(buildPhonemeLibrary(input).contrasts[0].contextGroups[0].hasCrossWordCapacity,false);
});

test('repeated segments retain the selected occurrence and changing it invalidates the word check',()=>{
  const input=fixture(),w=input[0].contrasts[0].pools[0][0];w.targetSegment='p';w.targetOccurrence=1;
  const first=buildPhonemeLibrary(input);assert.equal(first.contrasts[0].pools[0][0].targetOccurrence,1);
  w.targetOccurrence=2;assert.notEqual(buildPhonemeLibrary(input).contrasts[0].pools[0][0].key,first.contrasts[0].pools[0][0].key);
  w.targetOccurrence=0;assert.throws(()=>buildPhonemeLibrary(input));
});

test('a coupled-cue scope warning is retained and changes reopen affected reviews',()=>{
  const input=fixture(),before=buildPhonemeLibrary(input);
  input[0].contrasts[0].scopeNote='The neighboring consonant changes too.';
  const after=buildPhonemeLibrary(input);
  assert.equal(after.contrasts[0].scopeNote,input[0].contrasts[0].scopeNote);
  assert.notEqual(after.contrasts[0].key,before.contrasts[0].key);
  assert.notEqual(after.contrasts[0].pools[0][0].key,before.contrasts[0].pools[0][0].key);
});

test('permits labeled local editorial provenance without permitting path traversal or private file links',()=>{
  const input=fixture();const source=input[0].sources[1];source.kind='editorial';source.url='rescue/content/curriculum.json';
  assert.doesNotThrow(()=>buildPhonemeLibrary(input));
  for(const url of ['rescue/content/../secret','/Users/private/file','file:///etc/passwd']){source.url=url;assert.throws(()=>buildPhonemeLibrary(input));}
});

test('published research inventory expands all nine languages and carries no audio or approvals',()=>{
  const lib=getPhonemeLibrary();assert.equal(lib.languages.length,9);assert.ok(lib.contrasts.length>75);
  assert.ok(lib.contrasts.filter(c=>c.languageId==='en').length>=26);
  for(const id of ['de','es','it','zh','pt','ru']) assert.ok(lib.contrasts.filter(c=>c.languageId===id).length>3,id);
  assert.ok(lib.counts.uniqueWords>300);assert.ok(lib.counts.documentedStimulusMemberships>0);
  assert.ok(lib.contrasts.every(c=>c.status==='draft'));assert.equal(lib.stage,'text-review');
  for(const c of lib.contrasts) for(const member of c.pools.flat()) assert.ok(lib.words[member.wordId]);
  assert.doesNotMatch(JSON.stringify(lib),/"(?:audioUrl|clipId|voiceId|privateWavPath|approved)"|\/Users\/|\/private\//);
});

test('Spanish vowel coverage contains each of the ten comparisons once with usable word contexts',()=>{
  const lib=getPhonemeLibrary(),vowels=['a','e','i','o','u'];
  const comparisons=lib.contrasts.filter(c=>c.languageId==='es'&&c.categories.every(s=>vowels.includes(s.ipa)));
  assert.equal(comparisons.length,10);
  for(let i=0;i<vowels.length;i++)for(let j=i+1;j<vowels.length;j++){
    const found=comparisons.filter(c=>c.categories.map(s=>s.ipa).sort().join('|')===[vowels[i],vowels[j]].sort().join('|'));
    assert.equal(found.length,1,`${vowels[i]} / ${vowels[j]}`);
    assert.ok(found[0].pools.every(p=>p.length>=3));
    assert.ok(found[0].contextGroups.every(g=>g.hasCrossWordCapacity));
    assert.match(found[0].scopeNote,/not ten equally difficult/);
  }
});

test('Russian ы–и remains visible as a coupled vowel-and-consonant comparison, not fake vowel-only minimal pairs',()=>{
  const lib=getPhonemeLibrary(),c=lib.contrasts.find(c=>c.id==='ru-y-i');
  assert.ok(c);assert.deepEqual(c.categories.map(s=>s.ipa),['ɨ','i']);
  assert.equal(c.minimalPairs.length,0);assert.match(c.scopeNote,/consonant|onset/);
  assert.ok(c.pools.every(p=>p.length>=3));
  for(const id of ['ru-o-u','ru-a-o','ru-i-e','ru-y-u'])assert.ok(lib.contrasts.some(c=>c.id===id),id);
});

test('new vowel minimal-pair links differ only at the selected vowel occurrence',()=>{
  const lib=getPhonemeLibrary(),ids=['ru-a-o','ru-i-e','ru-y-u'];
  const comparisons=lib.contrasts.filter(c=>ids.includes(c.id)||(c.languageId==='es'&&c.categories.every(s=>['a','e','i','o','u'].includes(s.ipa))));
  const mask=(ipa,member)=>{
    let index=-1;
    for(let n=0;n<member.targetOccurrence;n++){index=ipa.indexOf(member.targetSegment,index+1);assert.ok(index>=0,'target occurrence exists');}
    return ipa.slice(0,index)+'#'+ipa.slice(index+member.targetSegment.length);
  };
  for(const c of comparisons){
    for(const member of c.pools.flat())mask(lib.words[member.wordId].ipa,member);
    for(const pair of c.minimalPairs){
      const left=c.pools[0].find(w=>w.wordId===pair.leftWordId),right=c.pools[1].find(w=>w.wordId===pair.rightWordId);
      assert.equal(mask(lib.words[left.wordId].ipa,left),mask(lib.words[right.wordId].ipa,right),c.id);
    }
  }
});

test('depth policy counts distinct words rather than repeated contexts or senses',()=>{
  const input=fixture(),c=input[0].contrasts[0];c.minimalPairs=[];
  for(const pool of c.pools){pool.push({...pool[0],meaning:'another sense'});pool.push({...pool[1],group:'another-context'});}
  const result=buildPhonemeLibrary(input).contrasts[0];
  assert.deepEqual(result.depth.distinctWords,[2,2]);assert.equal(result.depth.meetsMinimum,false);
  assert.equal(result.depth.hasMinimumContext,false);
});

test('four-word context floor and five-word target remain distinct from linguistic approval',()=>{
  const input=fixture(),c=input[0].contrasts[0];c.minimalPairs=[];
  c.pools=c.pools.map((pool,side)=>Array.from({length:4},(_,i)=>({...pool[0],text:`word-${side}-${i}`,ipa:`${pool[0].ipa}${i}`})));
  let result=buildPhonemeLibrary(input).contrasts[0];
  assert.deepEqual(result.depth,{distinctWords:[4,4],distinctPronunciations:[4,4],meetsMinimum:true,meetsTarget:false,hasMinimumContext:true});
  c.pools.forEach((pool,side)=>pool.push({...pool[0],text:`extra-${side}`,group:'another-context'}));
  result=buildPhonemeLibrary(input).contrasts[0];assert.equal(result.depth.meetsTarget,true);assert.equal(result.status,'draft');
  assert.equal(result.contextGroups.find(g=>g.id==='another-context').meetsMinimumDepth,false);
});

test('explicit English variety is preserved and cannot label another language',()=>{
  const input=fixture();input[0].contrasts[0].varietyId='en-US-ga';
  const ga=buildPhonemeLibrary(input);assert.equal(ga.contrasts[0].varietyId,'en-US-ga');
  input[0].contrasts[0].varietyId='en-GB-ssbe';
  const gb=buildPhonemeLibrary(input);assert.notEqual(ga.contrasts[0].pools[0][0].key,gb.contrasts[0].pools[0][0].key);
  input[0].contrasts[0].languageId='fr';assert.throws(()=>buildPhonemeLibrary(input));
});

test('audited sound pools meet the owner floor and omit rejected vocabulary',()=>{
  const lib=getPhonemeLibrary();
  assert.deepEqual(lib.contrasts.filter(c=>!c.depth.meetsMinimum).map(c=>({id:c.id,words:c.depth.distinctWords})),[]);
  assert.deepEqual(lib.contrasts.filter(c=>!c.depth.hasMinimumContext).map(c=>c.id),[]);
  assert.ok(!Object.values(lib.words).some(w=>w.languageId==='fr'&&w.text.toLowerCase()==='fun'));
  assert.ok(!Object.values(lib.words).some(w=>w.languageId==='ru'&&w.text.toLowerCase()==='таня'));
  const english=lib.contrasts.filter(c=>c.languageId==='en');assert.ok(english.every(c=>c.varietyId));
  assert.ok(english.some(c=>c.varietyId==='en-US-ga'));assert.ok(english.some(c=>c.varietyId==='en-GB-ssbe'));
});


test('homophones add spellings but never inflate pronunciation or context depth',()=>{
  const input=fixture(),c=input[0].contrasts[0];c.minimalPairs=[];
  c.pools=c.pools.map((pool,side)=>Array.from({length:5},(_,i)=>({...pool[0],text:`spelling-${side}-${i}`,ipa:i===1?`[${pool[0].ipa.replaceAll('/','')}]`:pool[0].ipa})));
  const result=buildPhonemeLibrary(input).contrasts[0];
  assert.deepEqual(result.depth.distinctWords,[5,5]);assert.deepEqual(result.depth.distinctPronunciations,[1,1]);
  assert.equal(result.depth.hasMinimumContext,false);assert.equal(result.contextGroups[0].meetsTargetDepth,false);
});


test('English accent banks are separate and Japanese is included without changing review status',()=>{
  const lib=getPhonemeLibrary();assert.equal(lib.banks.length,10);
  assert.deepEqual(lib.banks.filter(b=>b.languageId==='en').map(b=>b.id).sort(),['en-GB-ssbe','en-US-ga']);
  assert.ok(lib.banks.some(b=>b.id==='ja'&&b.languageId==='ja'));
  assert.ok(lib.contrasts.filter(c=>c.varietyId==='en-GB-ssbe').length>2);
  const ja=lib.contrasts.filter(c=>c.languageId==='ja');assert.ok(ja.length>=8);
  assert.ok(ja.every(c=>c.depth.meetsMinimum&&c.depth.hasMinimumContext&&c.status==='draft'));
  for(const c of ja)for(const m of c.pools.flat())assert.ok(lib.words[m.wordId].romanization&&lib.words[m.wordId].reading);
});

test('a frozen release rejects silent content changes without approving recordings or words',()=>{
  const lib=buildPhonemeLibrary(fixture());
  const release={id:'text-bank-v1',label:'Text bank v1',status:'frozen-for-audio-planning',frozenAt:'2026-10-01T00:00:00.000Z',libraryFingerprint:lib.fingerprint,scope:'Agreed inventory for next audio discussion',audioGenerated:0};
  assert.equal(attachTextBankRelease(lib,release).release.id,'text-bank-v1');
  assert.equal(lib.contrasts[0].status,'draft');
  const changed=fixture();changed[0].contrasts[0].pools[0][0].ipa='/other/';
  assert.throws(()=>attachTextBankRelease(buildPhonemeLibrary(changed),release),/frozen word bank changed/);
  assert.throws(()=>attachTextBankRelease(lib,{...release,audioGenerated:1}),/Invalid/);
  assert.throws(()=>attachTextBankRelease(lib,{...release,id:'not-versioned'}),/Invalid/);
});


test('version-one archive exactly preserves the selected text bank and source attribution',()=>{
  const library=getPhonemeLibrary();
  const snapshot=JSON.parse(fs.readFileSync(path.resolve('../content/phoneme-research/releases/text-bank-v1.json'),'utf8'));
  assert.equal(snapshot.fingerprint,'3c3d04a6c1c9b508684a83aed33562455b0bfc2c715ecd85ba6a672f82ae771d');
  assert.deepEqual(snapshot.contrasts.filter(c=>c.languageId!=='zh'),library.contrasts.filter(c=>c.languageId!=='zh'));
  assert.equal(snapshot.release.id,'text-bank-v1');assert.equal(snapshot.release.audioGenerated,0);
  assert.ok(snapshot.contrasts.every(c=>c.status==='draft'));
});

test('version-two archive pins the Mandarin correction without approving any recording',()=>{
  const library=getPhonemeLibrary();
  const snapshot=JSON.parse(fs.readFileSync(path.resolve('../content/phoneme-research/releases/text-bank-v2.json'),'utf8'));
  assert.deepEqual(snapshot,library);assert.equal(snapshot.release.audioGenerated,0);
  assert.equal(snapshot.mandarinBalance.trainingComparisons.length,6);
});

test('new Japanese and British links isolate their declared segments, with length targets matched in full',()=>{
  const library=getPhonemeLibrary();
  const contrasts=library.contrasts.filter(c=>c.languageId==='ja'||c.varietyId==='en-GB-ssbe');
  function mask(ipa,member){
    assert.ok(member.targetSegment&&member.targetOccurrence,'Selected target is explicit');
    let index=-1,offset=0;
    for(let n=0;n<member.targetOccurrence;n++){
      index=ipa.indexOf(member.targetSegment,offset);assert.ok(index>=0,`Target ${member.targetSegment} exists in ${ipa}`);offset=index+member.targetSegment.length;
    }
    assert.notEqual(ipa[offset],'ː',`Short target must not be a substring of a long target: ${ipa}`);
    return ipa.slice(0,index)+'#'+ipa.slice(offset);
  }
  for(const c of contrasts){
    for(const member of c.pools.flat())mask(library.words[member.wordId].ipa,member);
    for(const pair of c.minimalPairs){
      const left=c.pools[0].find(m=>m.wordId===pair.leftWordId),right=c.pools[1].find(m=>m.wordId===pair.rightWordId);
      assert.equal(mask(library.words[left.wordId].ipa,left),mask(library.words[right.wordId].ipa,right),c.id);
    }
  }
});


test('a Japanese kana-reading correction changes the word identity and is retained in export',()=>{
  const input=fixture();input[0].languageIds=['ja'];input[0].contrasts[0].languageId='ja';input[0].contrasts[0].pools[0][0].reading='みみ';
  const before=buildPhonemeLibrary(input),member=before.contrasts[0].pools[0][0];assert.equal(before.words[member.wordId].reading,'みみ');
  input[0].contrasts[0].pools[0][0].reading='しま';const after=buildPhonemeLibrary(input);
  assert.notEqual(after.contrasts[0].pools[0][0].key,member.key);
});
