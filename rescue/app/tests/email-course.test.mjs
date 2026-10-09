import test from 'node:test';import assert from 'node:assert/strict';
import {courseEnabled,subscriptionPayload,requestSubscription} from '../src/lib/email-course.mjs';
import {validateSubscription} from '../../email-course-service/worker.mjs';
test('intake requires explicit approval and HTTPS endpoint',()=>{assert.equal(courseEnabled(undefined,'https://example.com'),false);assert.equal(courseEnabled('true','http://example.com'),false);assert.equal(courseEnabled('true','https://example.com'),true)});
test('frontend payload matches backend contract with separate choices',()=>{const p=subscriptionPayload({email:' a@example.com ',language:'fr',course:true,weekly:false});assert.ok(validateSubscription(p));assert.equal(p.weekly,false)});
test('no choices does not submit',()=>assert.throws(()=>subscriptionPayload({email:'a@example.com',language:'fr',course:false,weekly:false})));
test('no browser credentials in request',async()=>{let seen;await requestSubscription('https://example.com/',{course:true},async(url,init)=>{seen={url,...init};return {ok:true}});assert.equal(seen.credentials,'omit');assert.equal(seen.url,'https://example.com/subscribe')});
test('service failure is not success',async()=>await assert.rejects(requestSubscription('https://example.com',{},async()=>({ok:false,status:503})),/not open/));
test('every template link references production curriculum and diagnostics',async()=>{
 const fs=await import('node:fs');const templates=JSON.parse(fs.readFileSync(new URL('../../company/email-course/templates.json',import.meta.url),'utf8'));
 assert.equal(templates.approved,false);assert.equal(templates.languages.length,9);
 for(const item of templates.languages){const key=item.bankId==='en-US-ga'?'us':item.bankId;const curriculum=JSON.parse(fs.readFileSync(new URL(`../src/data/${key}-chatterbox-curriculum.json`,import.meta.url),'utf8'));assert.equal(curriculum.id,item.practiceLanguageId);for(const [i,m] of item.messages.entries()){if(i<2){assert.equal(m.cta.url,`https://minimalpairs.co/learn/${curriculum.contrasts[i].id}`);}else assert.equal(m.cta.url,`https://minimalpairs.co/diagnostic/${curriculum.id}`);assert.ok(m.paragraphs.length);}}
});
test('signup placement follows diagnostic results and requires approval',async()=>{const fs=await import('node:fs');const source=fs.readFileSync(new URL('../src/components/Trainer.tsx',import.meta.url),'utf8');const result=source.indexOf('<DiagnosticResults');const form=source.indexOf('<EmailCourseSignup');assert.ok(result>0&&form>result);assert.match(source.slice(form-200,form),/journeyMode === 'diagnostic' && courseEnabled/);assert.match(source.slice(form,form+260),/language.id === 'en' \? 'en-US-ga' : language.id/);});
