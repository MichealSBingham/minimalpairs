import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticAttemptWords,diagnosticPhonemeLabel} from '../src/lib/diagnostic-report.ts';
const contrast={id:'fr-u-y',pairs:[{id:'pair',words:[{text:'tu',ipa:'/ty/'},{text:'tout',ipa:'/tu/'}]},{id:'x',words:[{text:'rue',ipa:'/ʁy/'},{text:'roue',ipa:'/ʁu/'}]}]};
const attempt={contrastId:'fr-u-y',pairId:'pair',word:'rue',chosenWord:'tu',correct:true};
test('historical correct answer preserves chosen match rather than selecting opposite word',()=>{
 assert.deepEqual(diagnosticAttemptWords(attempt,contrast).correct,{text:'tu',ipa:'/ty/'});
});
test('historical wrong answer infers other word only from identified reference pair',()=>{
 assert.equal(diagnosticAttemptWords({...attempt,chosenWord:'tout',correct:false},contrast).correct.text,'tu');
 assert.equal(diagnosticAttemptWords({...attempt,pairId:'missing',correct:false},contrast).correct,undefined);
 assert.equal(diagnosticAttemptWords({...attempt,chosenWord:'unknown',correct:false},contrast).correct,undefined);
});
test('saved exact heard and reference words/IPA take priority over inferred curriculum',()=>{
 const words=diagnosticAttemptWords({...attempt,correctWord:'rue',heardIpa:'/saved/',chosenIpa:'/choice/',correctIpa:'/exact/'},contrast);
 assert.equal(words.heard.ipa,'/saved/');assert.equal(words.chosen.ipa,'/choice/');assert.deepEqual(words.correct,{text:'rue',ipa:'/exact/'});
});
test('all rendered IPA is normalized without doubling delimiters',()=>{
 assert.equal(diagnosticPhonemeLabel(['/u/','y']),'/u/ – /y/');
 assert.equal(diagnosticAttemptWords({...attempt,heardIpa:'a\u0303'},contrast).heard.ipa,'ã');
});

test('legacy homographs never invent chosen, heard or matching IPA',()=>{
 const homograph={id:'stress',pairs:[{id:'record',words:[{text:'record',ipa:'/ˈrɛkərd/'},{text:'record',ipa:'/rɪˈkɔrd/'}]}]};
 for(const correct of [true,false]){
 const result=diagnosticAttemptWords({contrastId:'stress',pairId:'record',word:'record',chosenWord:'record',correct},homograph);
 assert.equal(result.correct,undefined);assert.equal(result.heard.ipa,'');assert.equal(result.chosen.ipa,'');
 }
 const explicit=diagnosticAttemptWords({contrastId:'stress',pairId:'record',word:'record',chosenWord:'record',correct:false,chosenIpa:'/ˈrɛkərd/',correctWord:'record',correctIpa:'/rɪˈkɔrd/'},homograph);
 assert.deepEqual(explicit.correct,{text:'record',ipa:'/rɪˈkɔrd/'});
});

const {diagnosticInsightCopy}=await import('../src/lib/diagnostic-insight-copy.ts');
test('summaries count sampled groups without unresolved placeholders in every interface language',()=>{
 for(const locale of ['en','es','fr','pt','de','it','ru','ja','zh']){
  const copy=diagnosticInsightCopy(locale,{solid:2,groups:6,focus:4});
  assert.ok(copy.summary.includes('2')&&copy.summary.includes('6'),locale);
  assert.ok(copy.focus.includes('4'),locale);
  for(const value of Object.values(copy))assert.ok(value&&!/[{}]/.test(value),locale);
 }
 assert.match(diagnosticInsightCopy('en',{solid:6,groups:6,focus:0}).perfect,/this check/);
 assert.equal(diagnosticInsightCopy('unknown').title,diagnosticInsightCopy('en').title);
});
