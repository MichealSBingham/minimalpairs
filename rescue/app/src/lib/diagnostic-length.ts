export type DiagnosticLength = 'short'|'full';
const copy:Record<string,string[]>={
en:['Check length','Short Test','Full Diagnostics','About {min}–{max} min · replays may take longer'],
fr:['Durée du test','Test court','Bilan complet','Environ {min}–{max} min · davantage avec les réécoutes'],
es:['Duración de la prueba','Prueba corta','Diagnóstico completo','Unos {min}–{max} min · más con repeticiones'],
pt:['Duração do teste','Teste curto','Diagnóstico completo','Cerca de {min}–{max} min · mais com repetições'],
de:['Testumfang','Kurztest','Vollständige Diagnose','Etwa {min}–{max} Min. · Wiederholungen brauchen länger'],
it:['Durata del test','Test breve','Bilan completo','Circa {min}–{max} min · di più con i riascolti'],
ru:['Длительность проверки','Короткий тест','Полная диагностика','Примерно {min}–{max} мин · повторы увеличивают время'],
ja:['チェックの長さ','ショートテスト','総合診断','約{min}〜{max}分 · 聞き直すと長くなります'],
zh:['测试长度','简短测试','全面诊断','约{min}–{max}分钟 · 重听需要更多时间']};
export function diagnosticLengthCopy(locale:string,rounds:number){const c=copy[locale]||copy.en;return {label:c[0],short:c[1],full:c[2],legacy:({en:'Earlier check',fr:'Test antérieur',es:'Prueba anterior',pt:'Teste anterior',de:'Früherer Test',it:'Test precedente',ru:'Предыдущая проверка',ja:'以前のチェック',zh:'以往测试'} as Record<string,string>)[locale]||'Earlier check',duration:c[3].replace('{min}',String(Math.max(1,Math.ceil(rounds*10/60)))).replace('{max}',String(Math.max(2,Math.ceil(rounds*20/60))))};}
