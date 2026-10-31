import test from 'node:test';
import assert from 'node:assert/strict';
import {locales,localPath,hasTranslations} from '../src/lib/locales.ts';
import {diagnosticCopy} from '../src/lib/diagnostic-i18n.ts';
test('every practice language has a translated diagnostic route',()=>{
 for(const locale of locales) for(const language of ['en','fr','de','es','it','zh','pt','ru','ja']) {
  const route=localPath(locale,`/diagnostic/${language}`);
  assert.equal(hasTranslations(route),true,route);
 }
 assert.equal(hasTranslations('/diagnostic/en-GB-ssbe'),false);
});
test('diagnostic copy covers all interface languages and explains next steps',()=>{
 for(const locale of locales){const copy=diagnosticCopy(locale);assert.equal(copy.steps.length,3);for(const [key,value] of Object.entries(copy)) {if(key==='resultsBody')assert.equal(value,'');else assert.ok(value.length>0,key);}if(locale!=='en')assert.notEqual(copy.title,diagnosticCopy('en').title);}
});
