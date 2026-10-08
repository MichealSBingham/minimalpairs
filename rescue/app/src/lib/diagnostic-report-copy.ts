const rows:Record<string,string[]>={
 en:['You heard','You chose','Correct match','Missed examples','correct matches','Example','Correct','Sound contrast'],
 es:['Escuchaste','Elegiste','Respuesta correcta','Ejemplos fallados','respuestas correctas','Ejemplo','Correctas','Contraste de sonidos'],
 fr:['Vous avez entendu','Vous avez choisi','Bonne correspondance','Exemples manqués','bonnes réponses','Exemple','Correctes','Contraste sonore'],
 pt:['Você ouviu','Você escolheu','Correspondência correta','Exemplos que você errou','respostas corretas','Exemplo','Corretas','Contraste de sons'],
 de:['Du hast gehört','Du hast gewählt','Passende Antwort','Beispiele mit Fehlern','richtige Antworten','Beispiel','Richtig','Lautkontrast'],
 it:['Hai ascoltato','Hai scelto','Abbinamento corretto','Esempi sbagliati','risposte corrette','Esempio','Corrette','Contrasto di suoni'],
 ru:['Вы услышали','Вы выбрали','Верное соответствие','Примеры с ошибками','верных ответов','Пример','Верно','Звуковой контраст'],
 ja:['聞いた単語','選んだ単語','正しい組み合わせ','間違えた例','正解','例','正解','音の対比'],
 zh:['你听到的词','你选择的词','正确匹配','答错的例子','答对','示例','正确','声音对比'],
};
export function diagnosticReportCopy(locale='en') {const r=rows[locale]||rows.en;return {heard:r[0],chosen:r[1],correctMatch:r[2],missed:r[3],matches:r[4],example:r[5],correct:r[6],contrast:r[7]};}
