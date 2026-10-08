import type {Contrast} from './types';
// A short, fixed starting-point sample, not a calibrated proficiency exam.
// Selection reflects core contrasts in the existing sourced curriculum. Difficulty
// depends on the learner's L1; never choose items or alter scoring to force failure.
const priorities: Record<string,string[]> = {
 en:['en-i-ih','en-r-l','en-th-s','en-foot-goose','en-v-w','en-trap-dress'],
 fr:['fr-u-y','fr-an-on','fr-an-in','fr-e-e-open','fr-eu-closed-open','fr-zh-sh'],
 de:['de-u-ue','de-i-length','de-o-oe','de-e-tense-lax','de-y-tense-lax','de-s-z'],
 es:['es-tap-trill','es-stress','es-d-tap','es-n-ny','es-e-i','es-p-b'],
 it:['it-p-length','it-t-length','it-e-open-e','it-o-open-o','it-l-length','it-p-b'],
 pt:['pt-oral-nasal-a','pt-tap-strong-r','pt-e-open-e','pt-o-open-o','pt-s-z','pt-p-b'],
 ru:['ru-y-i','ru-l-palatalized','ru-n-palatalized','ru-s-sh','ru-o-u','ru-b-p'],
 ja:['ja-i-length','ja-u-length','ja-k-length','ja-t-length','ja-s-sh','ja-k-g'],
 zh:['zh-tone-2-3','zh-tone-1-2','zh-tone-3-4','zh-p-aspiration','zh-s-sh','zh-n-ng'],
};
export const DIAGNOSTIC_ROUNDS_PER_GROUP=2;
export function selectDiagnosticContrasts(contrasts:Contrast[], languageId:string) {
 const ids=priorities[languageId]||[];
 return [...contrasts].sort((a,b)=>(ids.includes(a.id)?ids.indexOf(a.id):999)-(ids.includes(b.id)?ids.indexOf(b.id):999)).slice(0,6);
}
