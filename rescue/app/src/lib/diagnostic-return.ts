export const DIAGNOSTIC_RETURN_KEY = 'mp.diagnostic-return.v1';
const languages = new Set(['en','fr','de','es','it','zh','pt','ru','ja']);
export function saveDiagnosticReturn(storage: Pick<Storage,'setItem'>, language: string, completedAt: string, now = Date.now()) {
  if (!languages.has(language) || !Number.isFinite(Date.parse(completedAt))) return;
  try { storage.setItem(DIAGNOSTIC_RETURN_KEY, JSON.stringify({language,completedAt,createdAt:now})); } catch {}
}
export function diagnosticReturnPath(storage: Pick<Storage,'getItem'>, now = Date.now()): string | null {
  try {
    const value = JSON.parse(storage.getItem(DIAGNOSTIC_RETURN_KEY) || 'null');
    if (!value || !languages.has(value.language) || typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt)) || !Number.isFinite(value.createdAt) || value.createdAt > now || now-value.createdAt > 7*86400000) return null;
    return `/practice?language=${value.language}&session=diagnostic&report=${encodeURIComponent(value.completedAt)}#diagnostic-history`;
  } catch { return null; }
}
export function diagnosticReturnLabel(locale: string) {
 return ({en:'Return to your results',fr:'Revenir à vos résultats',es:'Volver a tus resultados',pt:'Voltar aos resultados',de:'Zurück zu deinen Ergebnissen',it:'Torna ai risultati',ru:'Вернуться к результатам',ja:'結果に戻る',zh:'返回结果'} as Record<string,string>)[locale] || 'Return to your results';
}
