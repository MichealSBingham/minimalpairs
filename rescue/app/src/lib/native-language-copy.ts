const copy:Record<string,string[]>={
en:['What is your first language?','Choose your language','We’ll use it to choose sounds that may be more challenging for you.'],
fr:['Quelle est votre langue maternelle ?','Choisissez votre langue','Nous choisirons des sons susceptibles de vous poser plus de difficultés.'],
es:['¿Cuál es tu lengua materna?','Elige tu idioma','La usaremos para elegir sonidos que pueden resultarte más difíciles.'],
pt:['Qual é sua língua materna?','Escolha seu idioma','Vamos escolher sons que podem ser mais difíceis para você.'],
de:['Was ist deine Muttersprache?','Wähle deine Sprache','Damit wählen wir Laute, die für dich schwieriger sein könnten.'],
it:['Qual è la tua lingua madre?','Scegli la tua lingua','La useremo per scegliere suoni che potrebbero essere più difficili per te.'],
ru:['Какой у вас родной язык?','Выберите язык','Мы подберём звуки, которые могут быть для вас сложнее.'],
ja:['母語は何ですか？','言語を選ぶ','母語に応じて、聞き分けが難しいと思われる音を選びます。'],
zh:['你的母语是什么？','选择语言','我们会据此选择对你可能更难区分的声音。']};
export function nativeLanguageCopy(locale:string){const r=copy[locale]||copy.en;return {label:r[0],choose:r[1],hint:r[2]};}
