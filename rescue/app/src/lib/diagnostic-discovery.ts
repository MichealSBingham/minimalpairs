import type {Locale} from './locales';
const copy: Record<Locale,{title:string; purpose:string}> = {
 en:{title:'Free minimal-pair listening test',purpose:'Can you hear the difference between similar words? This minimal-pair listening test helps language learners find sounds to practice. Listen first, then see the words, IPA and your answers in a personal sound profile.'},
 es:{title:'Test gratuito de pares mínimos',purpose:'¿Distingues palabras que suenan parecidas? Esta prueba de escucha con pares mínimos te ayuda a encontrar los sonidos que necesitas practicar. Primero escucha; después consulta las palabras, el AFI y tus respuestas en tu perfil de sonidos.'},
 fr:{title:'Test gratuit de paires minimales',purpose:'Distinguez-vous les mots qui se ressemblent à l’oreille ? Ce test d’écoute de paires minimales aide les apprenants à repérer les sons à travailler. Écoutez, puis retrouvez les mots, l’API et vos réponses dans votre profil sonore.'},
 pt:{title:'Teste gratuito de pares mínimos',purpose:'Você distingue palavras com sons parecidos? Este teste de escuta com pares mínimos ajuda a identificar os sons que precisa praticar. Primeiro ouça; depois veja as palavras, o AFI e suas respostas no seu perfil de sons.'},
 de:{title:'Kostenloser Minimalpaar-Hörtest',purpose:'Hörst du den Unterschied zwischen ähnlich klingenden Wörtern? Dieser Minimalpaar-Hörtest hilft dir, passende Lautübungen zu finden. Höre zuerst und sieh danach die Wörter, die IPA-Lautschrift und deine Antworten in deinem Lautprofil.'},
 it:{title:'Test gratuito di coppie minime',purpose:'Distingui parole che suonano simili? Questo test di ascolto con coppie minime ti aiuta a trovare i suoni da esercitare. Prima ascolta, poi guarda le parole, l’AFI e le tue risposte nel tuo profilo dei suoni.'},
 ru:{title:'Бесплатный тест на минимальные пары',purpose:'Различаете ли вы похожие по звучанию слова? Этот тест на слуховое различение минимальных пар помогает найти звуки для тренировки. Сначала слушайте, затем посмотрите слова, транскрипцию МФА и свои ответы в звуковом профиле.'},
 ja:{title:'無料ミニマルペア聞き分けテスト',purpose:'似た音の単語を聞き分けられますか？ミニマルペアの聞き分けテストで、練習する音を見つけましょう。まず音を聞き、その後で単語、IPA発音記号、自分の回答を確認できます。'},
 zh:{title:'免费最小对立体听辨测试',purpose:'你能听出相似单词之间的区别吗？这项最小对立体听辨测试帮助语言学习者找到需要练习的声音。先听声音，再查看单词、国际音标和自己的答案，了解个人听辨表现。'},
};
export function diagnosticDiscovery(locale:string='en'){return copy[locale as Locale]||copy.en;}
