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
