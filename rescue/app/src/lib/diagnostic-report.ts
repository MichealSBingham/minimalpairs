import type {Contrast} from './types';
export type DiagnosticAttempt = {contrastId:string;pairId:string;word:string;chosenWord:string;correct:boolean;correctWord?:string;heardIpa?:string;chosenIpa?:string;correctIpa?:string};
const clean=(value:string)=>value.normalize('NFC');
export function diagnosticAttemptWords(attempt:DiagnosticAttempt,contrast:Contrast) {
  const pair=contrast.pairs.find(pair=>pair.id===attempt.pairId);
  const namedChoices=pair?.words.filter(word=>clean(word.text)===clean(attempt.chosenWord))||[];
  const choices=attempt.chosenIpa?namedChoices.filter(word=>clean(word.ipa)===clean(attempt.chosenIpa!)):namedChoices;
  const chosen=choices.length===1?choices[0]:undefined;
  const ambiguousChoice=namedChoices.length>1&&!chosen;
  // Historical attempts did not save the matching reference. Infer it only from
  // an identified two-word reference pair. Homographs require saved IPA to resolve.
  const fallback=attempt.correct?chosen:chosen&&pair?.words.find(word=>word!==chosen);
  const explicitIpaMatches=attempt.correctIpa?pair?.words.filter(word=>clean(word.ipa)===clean(attempt.correctIpa!)):[];
  const ipaMatch=explicitIpaMatches?.length===1?explicitIpaMatches[0]:undefined;
  const correctWord=attempt.correctWord||ipaMatch?.text||(!ambiguousChoice?(attempt.correct?attempt.chosenWord:fallback?.text):undefined);
  const lookupIpa=(text:string|undefined)=>{
    const values=new Set(text?contrast.pairs.flatMap(pair=>pair.words).filter(word=>clean(word.text)===clean(text)).map(word=>clean(word.ipa)).filter(Boolean):[]);
    return values.size===1?[...values][0]:'';
  };
  return {
    heard:{text:clean(attempt.word),ipa:clean(attempt.heardIpa||lookupIpa(attempt.word))},
    chosen:{text:clean(attempt.chosenWord),ipa:clean(attempt.chosenIpa||chosen?.ipa||lookupIpa(attempt.chosenWord))},
    correct:correctWord?{text:clean(correctWord),ipa:clean(attempt.correctIpa||(fallback&&clean(fallback.text)===clean(correctWord)?fallback.ipa:'')||lookupIpa(correctWord))}:undefined,
  };
}
export function diagnosticExamplePair(contrast:Contrast,pairId?:string) {
  return contrast.pairs.find(pair=>pair.id===pairId)||contrast.pairs[0];
}
export function diagnosticPhonemeLabel(phonemes:string[]) {
  return phonemes.map(p=>p.includes(' ')?clean(p):`/${clean(p).replace(/^\/|\/$/g,'')}/`).join(' – ');
}
