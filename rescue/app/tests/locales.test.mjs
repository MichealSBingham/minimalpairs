import test from 'node:test';
import assert from 'node:assert/strict';
import {locales,localPath,unlocalizedPath,hasTranslations,navCopy,ogLocales} from '../src/lib/locales.ts';
import {feedbackText} from '../src/lib/feedback-i18n.ts';
test('switching interface language preserves the learning route',()=>{
 assert.equal(localPath('es','/fr/learn/fr-u-y'),'/es/learn/fr-u-y');
 assert.equal(localPath('en','/ja/learn/en-r-l'),'/learn/en-r-l');
 assert.equal(unlocalizedPath('/fr'),'/');
 assert.equal(localPath('pt','/'),'/pt');
});
test('all nine locales have navigation, feedback and social metadata',()=>{
 for(const locale of locales){assert.equal(navCopy[locale].length,11);assert.ok(ogLocales[locale]);for(let i=0;i<32;i++)assert.ok(feedbackText(locale,i));}
});
test('untranslated legal and editorial pages do not advertise fabricated translations',()=>{
 assert.equal(hasTranslations('/privacy'),false);assert.equal(hasTranslations('/method'),false);
 assert.equal(hasTranslations('/ja/learn/fr-u-y'),true);assert.equal(hasTranslations('/es/pricing'),true);
});
