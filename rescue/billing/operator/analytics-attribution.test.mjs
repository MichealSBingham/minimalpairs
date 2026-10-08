import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeAttribution,attributionMetadata,attributionFromMetadata} from '../analytics.mjs';
test('AI referral attribution survives checkout metadata and remains a fixed allowlist',()=>{
 for(const source of ['chatgpt','claude','perplexity','copilot','gemini']) {
  const input={source,medium:'referral',ui_locale:'en'};
  assert.deepEqual(attributionFromMetadata(attributionMetadata(input)),input);
 }
 for(const source of ['private@example.com','https://chatgpt.com/private','chatgpt.com.evil.test']) assert.equal(sanitizeAttribution({source,medium:'referral',ui_locale:'en'}),undefined);
 assert.equal(sanitizeAttribution({source:'chatgpt',medium:'referral',ui_locale:'en',prompt:'private'}),undefined);
});

test('landing metadata accepts only public routes while old source metadata stays compatible',()=>{
 const base={source:'google',medium:'organic',ui_locale:'en'};
 assert.deepEqual(attributionFromMetadata(attributionMetadata({...base,landing_page:'/fr/learn/fr-u-y?private=1'})),{...base,landing_page:'/fr/learn/fr-u-y'});
 for(const value of ['/account','/learn/en-customer-private','https://evil.test','x'.repeat(501)]) assert.deepEqual(sanitizeAttribution({...base,landing_page:value}),base);
 assert.deepEqual(attributionFromMetadata(attributionMetadata(base)),base);
});
