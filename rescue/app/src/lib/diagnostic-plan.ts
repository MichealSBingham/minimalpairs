import type {Contrast} from './types';
import type {DiagnosticLanguage} from './diagnostic-priorities.ts';
import {DIAGNOSTIC_LANGUAGES,DIAGNOSTIC_PRIORITIES,DIRECT_STUDY_PRIORITIES,L1_TRANSFER_PREDICTIONS,normalizeDiagnosticLanguage} from './diagnostic-priorities.ts';
export const DIAGNOSTIC_ROUNDS_PER_GROUP=2;
export const DIAGNOSTIC_MAX_GROUPS=6;
/** A short starting-point sample. L1 changes selection, never scoring or access.
 * Inventory predictions and study-supported contrasts are not calibrated norms.
 * Same-language, missing and unsupported L1s receive the broad sample. */
export function selectDiagnosticContrasts(contrasts:Contrast[], languageId:string, nativeLanguage?:string|null, length:'short'|'full'='short') {
 if(length==='full')return contrasts.filter(c=>c.pairs.length>=2);
 const targetCode=normalizeDiagnosticLanguage(languageId),native=normalizeDiagnosticLanguage(nativeLanguage);
 const target=DIAGNOSTIC_LANGUAGES.includes(targetCode as DiagnosticLanguage)?targetCode as DiagnosticLanguage:undefined;
 const priorities=target?DIAGNOSTIC_PRIORITIES[target]:[];
 const tailored=!!(target&&native&&target!==native);
 const direct=tailored?DIRECT_STUDY_PRIORITIES[target!]?.[native!]||[]:[];
 const profile=tailored?L1_TRANSFER_PREDICTIONS[native!]:{};
 const available=new Map(contrasts.map(c=>[c.id,c]));
 const ranked=priorities.map((p,index)=>({...p,index,score:(profile[p.feature]||0)+(direct.includes(p.id)?4:0)}))
  .filter(p=>available.has(p.id)).sort((a,b)=>b.score-a.score||a.index-b.index);
 const selected:Contrast[]=[],families=new Map<string,number>(),used=new Set<string>();
 for(const p of ranked){
  // Reserve diversity: Mandarin includes up to three tone pairs; other families
  // contribute at most two, before filling gaps in unusually sparse inventories.
  const cap=p.family==='tones'?3:2;
  if((families.get(p.family)||0)>=cap)continue;
  selected.push(available.get(p.id)!);used.add(p.id);families.set(p.family,(families.get(p.family)||0)+1);
  if(selected.length===DIAGNOSTIC_MAX_GROUPS)return selected;
 }
 for(const c of [...ranked.map(p=>available.get(p.id)!),...contrasts]){
  if(!used.has(c.id)){selected.push(c);used.add(c.id);}
  if(selected.length===DIAGNOSTIC_MAX_GROUPS)break;
 }
 return selected;
}
