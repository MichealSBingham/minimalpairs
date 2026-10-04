import type {Pair} from './types';
import type {PracticeQuestion, WordIndex} from './practice-engine';
/** One recorded word, two written choices. Answer side and voice vary independently. */
export function buildIdentificationSession(pairs: readonly Pair[], length=12, random=Math.random): PracticeQuestion[] {
  const eligible=pairs.filter(p=>p.words[0].text!==p.words[1].text || p.words[0].ipa!==p.words[1].ipa);
  if(!eligible.length)return [];
  const result:PracticeQuestion[]=[];
  let pool:Pair[]=[];
  for(let i=0;i<Math.floor(length);i++){
    if(!pool.length)pool=[...eligible];
    const pair=pool.splice(Math.min(pool.length-1,Math.floor(random()*pool.length)),1)[0];
    const target:WordIndex=random()<.5?0:1;
    const order:[WordIndex,WordIndex]=random()<.5?[0,1]:[1,0];
    result.push({pair,testPair:pair,target,order});
  }
  return result;
}
