/** Editorial L1-transfer predictions, not calibrated difficulty or proficiency norms.
 * Primary-study links and the precise limits of each override are in
 * rescue/research/diagnostic-l1-evidence.json. No score or answer is changed here.
 */
export const DIAGNOSTIC_LANGUAGES = ['en','fr','de','es','it','pt','ru','ja','zh'] as const;
export type DiagnosticLanguage = typeof DIAGNOSTIC_LANGUAGES[number];
export const DIAGNOSTIC_NATIVE_LANGUAGES = [...DIAGNOSTIC_LANGUAGES,'ar','hi','ko'] as const;
export type DiagnosticNativeLanguage = typeof DIAGNOSTIC_NATIVE_LANGUAGES[number];
export type DiagnosticFeature = 'highVowelQuality'|'lowVowelQuality'|'frontRounded'|'midVowelHeight'|'nasalVowels'|'vowelLength'|'consonantLength'|'palatalization'|'centralHighVowel'|'dentalFricative'|'liquidContrast'|'labiodentalVoicing'|'labiodentalApproximant'|'bilabialLabiodental'|'stopVoicing'|'fricativeVoicing'|'sibilantPlace'|'affrication'|'velarNasal'|'lexicalStress'|'tapTrill'|'dTap'|'palatalNasal'|'lexicalTone'|'aspiration';
export type DiagnosticPriority = {id:string; family:string; feature:DiagnosticFeature};
const item=(id:string,family:string,feature:DiagnosticFeature):DiagnosticPriority=>({id,family,feature});
/** The order is a broad editorial sample, also used for same-L1/unknown-L1 users. */
export const DIAGNOSTIC_PRIORITIES:Record<DiagnosticLanguage,DiagnosticPriority[]> = {
 en:[item('en-i-ih','vowel-quality','highVowelQuality'),item('en-r-l','liquids','liquidContrast'),item('en-th-s','dental-fricatives','dentalFricative'),item('en-foot-goose','vowel-quality','highVowelQuality'),item('en-v-w','labial-consonants','labiodentalApproximant'),item('en-trap-dress','low-vowels','lowVowelQuality'),item('en-v-b','labial-consonants','bilabialLabiodental'),item('en-th-t','dental-fricatives','dentalFricative'),item('en-sh-s','sibilants','sibilantPlace'),item('en-s-z','fricative-voicing','fricativeVoicing'),item('en-n-ng','nasals','velarNasal'),item('en-p-b','stop-voicing','stopVoicing'),item('en-f-v','labial-consonants','labiodentalVoicing'),item('en-ae-strut','low-vowels','lowVowelQuality'),item('en-sh-ch','affricates','affrication')],
 fr:[item('fr-u-y','front-rounding','frontRounded'),item('fr-an-on','nasal-vowels','nasalVowels'),item('fr-an-in','nasal-vowels','nasalVowels'),item('fr-e-e-open','mid-vowels','midVowelHeight'),item('fr-eu-closed-open','mid-vowels','midVowelHeight'),item('fr-zh-sh','fricative-voicing','fricativeVoicing'),item('fr-y-i','front-rounding','frontRounded'),item('fr-l-r','liquids','liquidContrast'),item('fr-b-v','labial-consonants','bilabialLabiodental'),item('fr-n-gn','nasals','palatalNasal'),item('fr-sh-s','sibilants','sibilantPlace'),item('fr-o-o-open','mid-vowels','midVowelHeight'),item('fr-a-an','nasal-vowels','nasalVowels'),item('fr-eh-eu-open','front-rounding','frontRounded')],
 de:[item('de-u-ue','front-rounding','frontRounded'),item('de-i-length','tense-lax','highVowelQuality'),item('de-o-oe','front-rounding','frontRounded'),item('de-e-tense-lax','mid-vowels','midVowelHeight'),item('de-y-tense-lax','tense-lax','highVowelQuality'),item('de-s-z','fricative-voicing','fricativeVoicing'),item('de-a-length','vowel-length','vowelLength'),item('de-o-tense-lax','mid-vowels','midVowelHeight'),item('de-u-tense-lax','tense-lax','highVowelQuality'),item('de-i-y-long','front-rounding','frontRounded'),item('de-oe-tense-lax','mid-vowels','midVowelHeight')],
 es:[item('es-tap-trill','rhotics','tapTrill'),item('es-stress','stress','lexicalStress'),item('es-d-tap','rhotics','dTap'),item('es-n-ny','nasals','palatalNasal'),item('es-e-i','vowel-height','midVowelHeight'),item('es-p-b','stop-voicing','stopVoicing'),item('es-d-trill','rhotics','tapTrill'),item('es-o-u','vowel-height','midVowelHeight'),item('es-t-d','stop-voicing','stopVoicing')],
 it:[item('it-p-length','stop-length','consonantLength'),item('it-t-length','stop-length','consonantLength'),item('it-e-open-e','mid-vowels','midVowelHeight'),item('it-o-open-o','mid-vowels','midVowelHeight'),item('it-l-length','sonorant-length','consonantLength'),item('it-p-b','stop-voicing','stopVoicing'),item('it-n-length','sonorant-length','consonantLength'),item('it-f-v','fricative-voicing','labiodentalVoicing'),item('it-k-length','stop-length','consonantLength')],
 pt:[item('pt-oral-nasal-a','nasal-vowels','nasalVowels'),item('pt-tap-strong-r','rhotics','tapTrill'),item('pt-e-open-e','mid-vowels','midVowelHeight'),item('pt-o-open-o','mid-vowels','midVowelHeight'),item('pt-s-z','fricative-voicing','fricativeVoicing'),item('pt-p-b','stop-voicing','stopVoicing'),item('pt-f-v','labial-consonants','labiodentalVoicing')],
 ru:[item('ru-y-i','central-vowels','centralHighVowel'),item('ru-l-palatalized','palatalization','palatalization'),item('ru-n-palatalized','palatalization','palatalization'),item('ru-s-sh','sibilants','sibilantPlace'),item('ru-o-u','vowel-height','midVowelHeight'),item('ru-b-p','stop-voicing','stopVoicing'),item('ru-y-u','central-vowels','centralHighVowel'),item('ru-t-palatalized','palatalization','palatalization'),item('ru-s-palatalized','palatalization','palatalization'),item('ru-d-t','stop-voicing','stopVoicing')],
 ja:[item('ja-i-length','vowel-length','vowelLength'),item('ja-u-length','vowel-length','vowelLength'),item('ja-k-length','consonant-length','consonantLength'),item('ja-t-length','consonant-length','consonantLength'),item('ja-s-sh','sibilants','sibilantPlace'),item('ja-k-g','stop-voicing','stopVoicing'),item('ja-e-length','vowel-length','vowelLength'),item('ja-s-length','consonant-length','consonantLength'),item('ja-t-d','stop-voicing','stopVoicing')],
 zh:[item('zh-tone-2-3','tones','lexicalTone'),item('zh-tone-1-2','tones','lexicalTone'),item('zh-tone-3-4','tones','lexicalTone'),item('zh-p-aspiration','aspiration','aspiration'),item('zh-s-sh','sibilants','sibilantPlace'),item('zh-n-ng','nasals','velarNasal'),item('zh-t-aspiration','aspiration','aspiration'),item('zh-k-aspiration','aspiration','aspiration'),item('zh-tone-1-4','tones','lexicalTone')],
};
/** Weights are prioritization heuristics, not error rates. Missing entries = no
 * special prediction, NOT proof that the sound is easy. Dialects/L2 experience vary. */
export const L1_TRANSFER_PREDICTIONS:Record<DiagnosticNativeLanguage,Partial<Record<DiagnosticFeature,number>>> = {
 en:{frontRounded:3,nasalVowels:3,vowelLength:2,consonantLength:3,palatalization:3,centralHighVowel:3,midVowelHeight:1,tapTrill:3,dTap:3,palatalNasal:2,lexicalTone:3,aspiration:1},
 fr:{highVowelQuality:3,lowVowelQuality:2,vowelLength:3,consonantLength:3,palatalization:3,centralHighVowel:3,dentalFricative:3,affrication:1,velarNasal:1,lexicalStress:3,tapTrill:3,dTap:2,lexicalTone:3,aspiration:3},
 de:{frontRounded:0,nasalVowels:3,consonantLength:3,palatalization:3,centralHighVowel:3,dentalFricative:3,lowVowelQuality:2,labiodentalApproximant:3,tapTrill:2,dTap:2,palatalNasal:2,lexicalTone:3},
 es:{highVowelQuality:3,lowVowelQuality:3,frontRounded:3,midVowelHeight:3,nasalVowels:3,vowelLength:3,consonantLength:3,palatalization:3,centralHighVowel:3,dentalFricative:1,labiodentalVoicing:3,labiodentalApproximant:2,bilabialLabiodental:3,fricativeVoicing:3,sibilantPlace:2,velarNasal:1,lexicalTone:3,aspiration:3},
 it:{highVowelQuality:3,lowVowelQuality:3,frontRounded:3,nasalVowels:3,vowelLength:3,palatalization:3,centralHighVowel:3,dentalFricative:3,velarNasal:1,lexicalTone:3,aspiration:3},
 pt:{highVowelQuality:3,lowVowelQuality:3,frontRounded:3,vowelLength:3,consonantLength:3,palatalization:3,centralHighVowel:3,dentalFricative:3,velarNasal:1,lexicalTone:3,aspiration:3},
 ru:{highVowelQuality:3,lowVowelQuality:2,frontRounded:3,midVowelHeight:3,nasalVowels:3,vowelLength:3,consonantLength:2,dentalFricative:3,labiodentalApproximant:3,velarNasal:2,tapTrill:1,dTap:1,palatalNasal:1,lexicalTone:3,aspiration:3},
 ja:{highVowelQuality:3,lowVowelQuality:3,frontRounded:3,midVowelHeight:2,nasalVowels:3,palatalization:2,centralHighVowel:2,dentalFricative:3,liquidContrast:3,labiodentalVoicing:3,labiodentalApproximant:3,bilabialLabiodental:3,fricativeVoicing:1,affrication:1,velarNasal:1,lexicalStress:2,tapTrill:3,dTap:2,palatalNasal:1,lexicalTone:2,aspiration:2},
 ar:{highVowelQuality:3,lowVowelQuality:3,frontRounded:3,midVowelHeight:2,nasalVowels:3,palatalization:3,centralHighVowel:3,labiodentalVoicing:3,labiodentalApproximant:3,bilabialLabiodental:3,stopVoicing:4,fricativeVoicing:1,affrication:1,velarNasal:3,tapTrill:1,dTap:2,palatalNasal:3,lexicalTone:3,aspiration:2},
 hi:{highVowelQuality:1,lowVowelQuality:2,frontRounded:3,midVowelHeight:1,nasalVowels:1,palatalization:3,centralHighVowel:3,dentalFricative:3,labiodentalVoicing:2,labiodentalApproximant:3,bilabialLabiodental:2,fricativeVoicing:1,velarNasal:1,tapTrill:2,dTap:2,palatalNasal:2,lexicalTone:3},
 ko:{highVowelQuality:3,lowVowelQuality:2,frontRounded:3,midVowelHeight:2,nasalVowels:3,vowelLength:2,consonantLength:3,palatalization:2,centralHighVowel:2,dentalFricative:3,liquidContrast:3,labiodentalVoicing:3,labiodentalApproximant:3,bilabialLabiodental:3,stopVoicing:3,fricativeVoicing:3,affrication:1,lexicalStress:3,tapTrill:3,dTap:2,palatalNasal:2,lexicalTone:3},
 zh:{highVowelQuality:3,lowVowelQuality:3,frontRounded:1,midVowelHeight:2,nasalVowels:3,vowelLength:3,consonantLength:3,palatalization:2,centralHighVowel:2,dentalFricative:3,liquidContrast:1,labiodentalVoicing:3,labiodentalApproximant:3,bilabialLabiodental:3,stopVoicing:3,fricativeVoicing:3,affrication:1,lexicalStress:2,tapTrill:3,dTap:2,palatalNasal:2},
};
/** Studies support testing these distinctions in these populations. They do not
 * supply a validated ordering or a prediction for an individual learner. */
export const DIRECT_STUDY_PRIORITIES:Partial<Record<DiagnosticLanguage,Partial<Record<DiagnosticNativeLanguage,string[]>>>> = {
 en:{ja:['en-r-l','en-th-s'],ko:['en-i-ih','en-trap-dress']},
 fr:{en:['fr-u-y','fr-y-i','fr-eh-eu-open']},
 de:{en:['de-u-ue','de-o-oe'],zh:['de-i-length','de-y-tense-lax','de-e-tense-lax']},
 es:{en:['es-d-tap','es-tap-trill'],fr:['es-stress']},
 it:{en:['it-p-length','it-t-length']},
 pt:{ru:['pt-e-open-e','pt-o-open-o']},
 ru:{es:['ru-y-i']},
 ja:{en:['ja-i-length','ja-u-length','ja-k-length','ja-t-length']},
 zh:{en:['zh-tone-2-3','zh-tone-1-2'],ja:['zh-tone-2-3','zh-tone-1-2']},
};
const ALIASES:Record<string,DiagnosticNativeLanguage>={arabic:'ar',hindi:'hi',korean:'ko','العربية':'ar','हिन्दी':'hi','हिंदी':'hi','한국어':'ko',english:'en',french:'fr',german:'de',spanish:'es',italian:'it',portuguese:'pt',russian:'ru',japanese:'ja',chinese:'zh',mandarin:'zh','mandarin chinese':'zh',français:'fr',francais:'fr',deutsch:'de',español:'es',espanol:'es',italiano:'it',português:'pt',portugues:'pt','русский':'ru','日本語':'ja','中文':'zh','普通话':'zh'};
export function normalizeDiagnosticLanguage(value?:string|null):DiagnosticNativeLanguage|undefined {
 const input=value?.trim().toLowerCase();if(!input)return undefined;
 if(ALIASES[input])return ALIASES[input];
 const code=input.split(/[-_]/)[0];
 return DIAGNOSTIC_NATIVE_LANGUAGES.includes(code as DiagnosticNativeLanguage)?code as DiagnosticNativeLanguage:undefined;
}
