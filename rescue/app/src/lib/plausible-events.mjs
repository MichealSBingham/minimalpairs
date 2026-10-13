export const plausibleEvents = Object.freeze({
 page_view:'pageview', practice_start:'Practice started', practice_first_answer:'First answer',
 practice_answer:'Answer submitted', practice_complete:'Practice completed', practice_exit:'Practice exited',
 practice_audio_error:'Audio error', diagnostic_start:'Diagnostic started', diagnostic_complete:'Diagnostic completed',
 diagnostic_results_view:'Results viewed', diagnostic_report_preview:'Report previewed', diagnostic_report_open:'Report opened',
 diagnostic_report_unlock_click:'Report unlock clicked', diagnostic_offer_click:'Diagnostic offer clicked', plans_view:'Pricing viewed', paywall_view:'Paywall viewed',
 plan_selected:'Plan selected', begin_checkout:'Checkout started', checkout_resumed:'Checkout resumed', checkout_error:'Checkout error',
 login:'Sign in', guide_audio_play:'Sound guide played', challenge_start:'Challenge started', challenge_complete:'Challenge completed',course_signup:'Email signup',
});
export function plausibleProperties(data={}){
 const result={};
 if(['blocked','network','decode','unsupported','timeout','unknown'].includes(data.failure_kind))result.failure_kind=data.failure_kind;
 if(['short','full'].includes(data.diagnostic_length))result.diagnostic_length=data.diagnostic_length;
 for(const [input,output] of Object.entries({language_id:'language',contrast_id:'contrast',session_kind:'session',activity_mode:'mode',surface:'surface',plan:'plan',ui_locale:'interface_language',access_tier:'access'})){
  const v=data[input];if(typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v))result[output]=v;
 }
 for(const k of ['round','correct','total'])if(Number.isInteger(data[k])&&data[k]>=0&&data[k]<=1000)result[k]=data[k];
 return result;
}
