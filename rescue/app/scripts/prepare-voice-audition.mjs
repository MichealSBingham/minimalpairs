import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(app, '..');
const runs = path.join(root, 'audio/voice-audition-v2/runs') + path.sep;
const inputs = process.argv.slice(2).map(input=>path.resolve(input));
if (!inputs.length) throw new Error('Supply a completed isolated audition manifest.');
const candidates = inputs.map(input=>{
  if (!input.startsWith(runs) || !input.endsWith('/manifest.json')) throw new Error('Supply a completed isolated audition manifest.');
  const candidate=JSON.parse(fs.readFileSync(input,'utf8'));
  if (candidate.status !== 'complete') throw new Error('The audition is still running.');
  return {...candidate,clips:candidate.clips.map(clip=>({...clip,sourceDirectory:path.dirname(input)}))};
});
const candidate = {id: candidates.length > 1 ? 'mandarin-local-comparison-20261001' : candidates[0].id, createdAt: new Date().toISOString(), purpose:'Compare fixed local voice candidates on the same Mandarin words; all pronunciation checks remain pending.', providerNotes:[...new Set(candidates.flatMap(c=>c.providerNotes))], clips:candidates.flatMap(c=>c.clips)};
const balance = JSON.parse(fs.readFileSync(path.join(root,'content/phoneme-research/mandarin-balance.json'),'utf8'));
const release = JSON.parse(fs.readFileSync(path.join(root,'content/phoneme-research/text-bank-release.json'),'utf8'));
const words = new Map(balance.lexicalItems.map(word=>[word.id,word]));
const expected = new Set(balance.audition.wordIds);
const voices = [...new Set(candidate.clips.map(clip=>clip.voiceId))];
if (voices.length < 2 || candidate.clips.length !== expected.size * voices.length) throw new Error('Audition must cover the same words in every voice.');
const seen = new Set(), hashes = new Set();
const copies = [];
const clips = candidate.clips.map(clip=>{
  const word = words.get(clip.wordId);
  if (!word || !expected.has(word.id) || word.split !== 'train' || clip.languageId !== 'zh' || clip.bankId !== 'zh' || clip.locale !== 'cmn-CN') throw new Error('Unexpected word, split or language in audition.');
  if (clip.text !== word.text || clip.ipa !== word.ipa || clip.reading !== word.romanization || clip.meaning !== word.meaning) throw new Error('Candidate intended word differs from the current text bank.');
  const member = `${word.id}:${clip.voiceId}`;
  if (seen.has(member)) throw new Error('Duplicate audition word/voice slot');
  seen.add(member);
  if (!/^[a-zA-Z0-9_-]+$/.test(clip.id) || !/^[a-f0-9]{64}$/.test(clip.sha256)) throw new Error('Invalid audition identity');
  const source = path.join(clip.sourceDirectory,'clips',`${clip.id}.wav`);
  const real = fs.realpathSync(source);
  if (!real.startsWith(runs)) throw new Error('Audio source escaped the isolated run');
  const bytes = fs.readFileSync(real), sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== clip.sha256 || hashes.has(sha)) throw new Error('Changed or duplicated audition audio bytes');
  hashes.add(sha);
  if (!['pass','needs-review'].includes(clip.technicalStatus)) throw new Error('Missing or failed clip; retain a complete diagnostic batch before publishing.');
  const url = `/audio/voice-audition-v2/clips/${clip.id}.wav`;
  copies.push({source:real,destination:path.join(app,'public',url)});
  return {id:clip.id,wordId:word.id,bankId:clip.bankId,languageId:clip.languageId,text:word.text,reading:word.romanization,ipa:word.ipa,meaning:word.meaning,provider:clip.provider,model:clip.model,modelRevision:clip.modelRevision,generationProfileId:clip.generationProfileId||clip.voiceId,generationSettings:clip.generationSettings,seed:clip.seed,take:clip.take,synthesisText:clip.synthesisText||clip.inputText||clip.text,repairOfClipId:clip.repairOfClipId,voiceId:clip.voiceId,locale:clip.locale,requestedLanguage:clip.requestedLanguage||clip.language||'Chinese',url,sha256:sha,technicalStatus:clip.technicalStatus,technicalFlags:clip.technicalFlags||[],metrics:clip.metrics,reviewStatus:'unreviewed',...(clip.aiAudit?{aiAudit:clip.aiAudit}:{})};
});
const output = {kind:'minimalpairs-voice-audition',id:candidate.id,createdAt:candidate.createdAt,textBankId:release.id,textBankFingerprint:release.libraryFingerprint,purpose:candidate.purpose,providerNotes:candidate.providerNotes,clips};
for (const {source,destination} of copies) { fs.mkdirSync(path.dirname(destination),{recursive:true}); fs.copyFileSync(source,destination); }
fs.writeFileSync(path.join(app,'public/audio/voice-audition-v2/manifest.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({id:output.id,words:expected.size,voices:voices.length,clips:clips.length,technicalFlags:clips.filter(c=>c.technicalStatus!=='pass').length,reviewStatus:'unreviewed'}));
