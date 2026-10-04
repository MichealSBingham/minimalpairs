export const locales = ['en','es','fr','pt','de','it','ru','ja','zh'] as const;
export type Locale = typeof locales[number];
export const localeNames: Record<string,string> = {en:'English',es:'Español',fr:'Français',pt:'Português',de:'Deutsch',it:'Italiano',ru:'Русский',ja:'日本語',zh:'简体中文'};
export const ogLocales: Record<string,string> = {en:'en_US',es:'es_ES',fr:'fr_FR',pt:'pt_BR',de:'de_DE',it:'it_IT',ru:'ru_RU',ja:'ja_JP',zh:'zh_CN'};
export function unlocalizedPath(path: string) { return path.replace(/^\/(es|fr|pt|de|it|ru|ja|zh)(?=\/|$)/,'') || '/'; }
export function localPath(locale: string, path: string) {const clean=unlocalizedPath(path);return locale==='en'?clean:`/${locale}${clean==='/'?'':clean}`;}
export function hasTranslations(path: string) {const p=unlocalizedPath(path);return ['/', '/practice','/account','/pricing','/support'].includes(p)||/^\/learn\/[a-z0-9-]+$/.test(p)||/^\/[a-z-]+-minimal-pairs$/.test(p);}
export const navCopy: Record<string,string[]> = {
 en:['How it works','Languages','Sound guides','My account','Lessons','Practice','Plans','Help & contact','Privacy','Terms','Small sounds. A world of difference.'],
 es:['Cómo funciona','Idiomas','Guías de sonidos','Mi cuenta','Lecciones','Practicar','Planes','Ayuda y contacto','Privacidad','Condiciones','Pequeños sonidos. Una gran diferencia.'],
 fr:['Comment ça marche','Langues','Guides des sons','Mon compte','Leçons','Pratiquer','Offres','Aide et contact','Confidentialité','Conditions','De petits sons. Toute la différence.'],
 pt:['Como funciona','Idiomas','Guias de sons','Minha conta','Lições','Praticar','Planos','Ajuda e contato','Privacidade','Termos','Pequenos sons. Uma grande diferença.'],
 de:['So funktioniert es','Sprachen','Lautübersichten','Mein Konto','Lektionen','Üben','Tarife','Hilfe & Kontakt','Datenschutz','Nutzungsbedingungen','Kleine Laute. Ein großer Unterschied.'],
 it:['Come funziona','Lingue','Guide ai suoni','Il mio account','Lezioni','Esercitati','Piani','Aiuto e contatti','Privacy','Condizioni','Piccoli suoni. Una grande differenza.'],
 ru:['Как это работает','Языки','Справочник звуков','Мой аккаунт','Уроки','Практика','Тарифы','Помощь и контакты','Конфиденциальность','Условия','Маленькие звуки. Большая разница.'],
 ja:['使い方','言語','音のガイド','マイアカウント','レッスン','練習','プラン','ヘルプ・お問い合わせ','プライバシー','利用規約','小さな音の違いが、大きな違いに。'],
 zh:['使用方法','语言','语音指南','我的账户','课程','练习','方案','帮助与联系','隐私政策','服务条款','细微的声音，重要的区别。'],
};
