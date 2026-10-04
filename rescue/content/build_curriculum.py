"""Author-maintained starter curriculum. This does not certify any audio asset."""
import json
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
LANGUAGES = []

def word(text, ipa, meaning, segments, romanization=None):
    result = dict(text=text, ipa=f'/{ipa}/', meaning=meaning, phonemes=segments.split())
    if romanization: result['romanization'] = romanization
    return result

def pair(id, a, b, sources, kind='minimal', note=None):
    result = dict(id=id, words=[word(*a), word(*b)], kind=kind, sources=sources,
                  validation={'text':'editor-curated', 'audio':'pending-listening-review'})
    if note: result['note'] = note
    return result

def contrast(id, label, phonemes, description, pairs, sources, notes=None):
    return dict(id=id,label=label,phonemes=phonemes,description=description,
                l1Notes=notes or [], pairs=pairs,sources=sources)

def language(id,name,nativeName,locale,dialect,tagline,contrasts):
    LANGUAGES.append(dict(id=id,name=name,nativeName=nativeName,locale=locale,
        dialect=dialect,tagline=tagline,contrasts=contrasts,
        scope='Starter curriculum; not a complete inventory of the language.',
        audioStatus='Audio assets require a separate pronunciation and licensing review.'))

def cam(*words): return ['https://dictionary.cambridge.org/dictionary/english/'+quote(w) for w in words]
def cnrtl(*words): return ['https://www.cnrtl.fr/definition/'+quote(w) for w in words]
def duden(*words):
    aliases={'Miete':'Miete_Pacht','Mutter':'Mutter_Frau','werden':'werden_Hilfsverb','weisz':'weisz_hell_hellhaeutig_bleich'}
    return ['https://www.duden.de/rechtschreibung/'+quote(aliases.get(w,w)) for w in words]
def rae(*words): return ['https://dle.rae.es/'+quote(w) for w in words]
def treccani(*words):
    aliases={'pala':'pala1','palla':'palla1','fatto':'fatto2','fino':'fino1','varo':'varo2'}
    return ['https://www.treccani.it/vocabolario/'+quote(aliases.get(w,w))+'/' for w in words]
def priberam(*words): return ['https://dicionario.priberam.org/'+quote(w) for w in words]
def gramota(*words): return ['https://gramota.ru/poisk?query='+quote(w)+'&mode=slovari' for w in words]

en_source='https://dictionary.cambridge.org/help/phonetics.html'
language('en','English','English','en-US','General American','Hear the small differences that change a word.',[
 contrast('en-i-ih','Ship or sheep?',['ɪ','i'],
  'Listen for the vowel quality in ship and sheep. Length can help, but stretching a vowel alone does not make it the other vowel.',[
   pair('en-ship-sheep',('ship','ʃɪp','a large boat','ʃ ɪ p'),('sheep','ʃip','a woolly animal','ʃ i p'),cam('ship','sheep')),
   pair('en-fill-feel',('fill','fɪl','make full','f ɪ l'),('feel','fil','sense or experience','f i l'),cam('fill','feel')),
   pair('en-sit-seat',('sit','sɪt','be seated','s ɪ t'),('seat','sit','a place to sit','s i t'),cam('sit','seat')),
  ],[en_source],[{'nativeLanguage':'es','note':'These two English vowel categories do not map one-to-one onto Spanish spelling. Start with listening, then use the labels.'}]),
 contrast('en-r-l','Right or light?',['ɹ','l'],
  'Listen to the start of each word. Keep the rest of the word in mind so that the changing first sound stands out.',[
   pair('en-right-light',('right','ɹaɪt','correct; opposite of left','ɹ aɪ t'),('light','laɪt','brightness','l aɪ t'),cam('right','light')),
   pair('en-road-load',('road','ɹoʊd','a route for vehicles','ɹ oʊ d'),('load','loʊd','something being carried','l oʊ d'),cam('road','load')),
   pair('en-rice-lice',('rice','ɹaɪs','a grain used as food','ɹ aɪ s'),('lice','laɪs','plural of louse','l aɪ s'),cam('rice','lice')),
  ],[en_source],[{'nativeLanguage':'ja','note':'English uses two categories here. Your own starting point matters more than your native-language label; the diagnostic will check this contrast.'}]),
 contrast('en-th-s','Thin or sin?',['θ','s'],
  'Compare the softer, diffuse noise at the start of thin with the sharper hiss at the start of sin.',[
   pair('en-thin-sin',('thin','θɪn','not thick','θ ɪ n'),('sin','sɪn','a moral wrong','s ɪ n'),cam('thin','sin')),
   pair('en-thick-sick',('thick','θɪk','having depth','θ ɪ k'),('sick','sɪk','ill','s ɪ k'),cam('thick','sick')),
   pair('en-thigh-sigh',('thigh','θaɪ','upper part of a leg','θ aɪ'),('sigh','saɪ','a long breath','s aɪ'),cam('thigh','sigh')),
  ],[en_source])
])

fr_source='https://doi.org/10.1017/S0025100300004874'
language('fr','French','Français','fr-FR','Metropolitan French','Make French vowels and close sound contrasts clearer.',[
 contrast('fr-u-y','Tout or tu?',['u','y'],
  'Both vowels use rounded lips. For tu, the tongue is farther forward than for tout. Listen to the complete vowel rather than adding a y sound.',[
   pair('fr-tout-tu',('tout','tu','all; everything','t u'),('tu','ty','you, informal singular','t y'),cnrtl('tout','tu')),
   pair('fr-vous-vu',('vous','vu','you, formal or plural','v u'),('vu','vy','seen','v y'),cnrtl('vous','voir')),
   pair('fr-roue-rue',('roue','ʁu','wheel','ʁ u'),('rue','ʁy','street','ʁ y'),cnrtl('roue','rue')),
   pair('fr-bout-bu',('bout','bu','end; tip','b u'),('bu','by','drunk, past participle of drink','b y'),cnrtl('bout','boire')),
  ],[fr_source],[{'nativeLanguage':'en','note':'Tu is not the English sequence in you. Listen for one rounded vowel without an extra glide.'},{'nativeLanguage':'es','note':'The spelling u does not represent the familiar Spanish /u/ here. French ou is the closer spelling match for that sound.'}]),
 contrast('fr-an-on','Banc or bon?',['ɑ̃','ɔ̃'],
  'These are two nasal vowels. Listen to their different vowel qualities; there is no separate final n in these isolated words.',[
   pair('fr-banc-bon',('banc','bɑ̃','bench','b ɑ̃'),('bon','bɔ̃','good','b ɔ̃'),cnrtl('banc','bon')),
   pair('fr-pan-pont',('pan','pɑ̃','section; panel','p ɑ̃'),('pont','pɔ̃','bridge','p ɔ̃'),cnrtl('pan','pont')),
   pair('fr-tant-ton',('tant','tɑ̃','so much','t ɑ̃'),('ton','tɔ̃','your; tone','t ɔ̃'),cnrtl('tant','ton')),
  ],[fr_source]),
 contrast('fr-s-z','Poisson or poison?',['s','z'],
  'Listen for the difference between a hiss and a voiced buzz. Here the rest of each word stays the same.',[
   pair('fr-poisson-poison',('poisson','pwasɔ̃','fish','p w a s ɔ̃'),('poison','pwazɔ̃','poison','p w a z ɔ̃'),cnrtl('poisson','poison')),
   pair('fr-coussin-cousin',('coussin','kusɛ̃','cushion','k u s ɛ̃'),('cousin','kuzɛ̃','male cousin','k u z ɛ̃'),cnrtl('coussin','cousin')),
   pair('fr-basse-base',('basse','bas','low, feminine','b a s'),('base','baz','base','b a z'),cnrtl('bas','base')),
  ],[fr_source])
])

de_source='https://doi.org/10.1017/S0025100300004084'
language('de','German','Deutsch','de-DE','Standard German as spoken in Germany','Tune in to umlauts, vowel quality and consonant contrasts.',[
 contrast('de-u-ue','Musste or müsste?',['ʊ','ʏ'],
  'Both vowels are short and rounded. The vowel in müsste is farther forward. The umlaut changes the vowel, not the number of syllables.',[
   pair('de-musste-muesste',('musste','ˈmʊstə','had to','m ʊ s t ə'),('müsste','ˈmʏstə','would have to','m ʏ s t ə'),duden('muessen')),
   pair('de-wurde-wuerde',('wurde','ˈvʊʁdə','became; was','v ʊ ʁ d ə'),('würde','ˈvʏʁdə','would','v ʏ ʁ d ə'),duden('werden')),
   pair('de-mutter-muetter',('Mutter','ˈmʊtɐ','mother','m ʊ t ɐ'),('Mütter','ˈmʏtɐ','mothers','m ʏ t ɐ'),duden('Mutter')),
  ],[de_source]),
 contrast('de-i-length','Bitten or bieten?',['ɪ','iː'],
  'The vowel changes in quality as well as duration. Compare complete words rather than treating this as a stopwatch exercise.',[
   pair('de-bitten-bieten',('bitten','ˈbɪtən','ask; request','b ɪ t ə n'),('bieten','ˈbiːtən','offer','b iː t ə n'),duden('bitten','bieten'),note='Careful citation forms shown. Natural speech may use a syllabic final n in both words.'),
   pair('de-mitte-miete',('Mitte','ˈmɪtə','middle','m ɪ t ə'),('Miete','ˈmiːtə','rent','m iː t ə'),duden('Mitte','Miete')),
   pair('de-schiff-schief',('Schiff','ʃɪf','ship','ʃ ɪ f'),('schief','ʃiːf','crooked','ʃ iː f'),duden('Schiff','schief')),
  ],[de_source]),
 contrast('de-s-z','Reißen or reisen?',['s','z'],
  'Compare the unvoiced hiss in reißen with the voiced sound in reisen. The long vowel or diphthong stays the same.',[
   pair('de-reissen-reisen',('reißen','ˈʁaɪsən','tear; rip','ʁ aɪ s ə n'),('reisen','ˈʁaɪzən','travel','ʁ aɪ z ə n'),duden('reiszen','reisen')),
   pair('de-weisse-weise',('weiße','ˈvaɪsə','white, inflected','v aɪ s ə'),('weise','ˈvaɪzə','wise','v aɪ z ə'),duden('weisz','weise')),
   pair('de-musse-muse',('Muße','ˈmuːsə','leisure','m uː s ə'),('Muse','ˈmuːzə','muse; source of inspiration','m uː z ə'),duden('Musze','Muse')),
  ],[de_source]),
 contrast('de-o-oe','Schon or schön?',['oː','øː'],
  'Keep the lips rounded for both vowels. The stressed long vowel changes from back to front while the remaining sounds stay the same within each pair.',[
   pair('de-schon-schoen',('schon','ʃoːn','already','ʃ oː n'),('schön','ʃøːn','beautiful','ʃ øː n'),duden('schon_bereits_eh_laengst','schoen')),
   pair('de-rohre-roehre',('Rohre','ˈʁoːʁə','pipes','ʁ oː ʁ ə'),('Röhre','ˈʁøːʁə','tube','ʁ øː ʁ ə'),duden('Rohr','Roehre')+['https://en.langenscheidt.com/german-english/rohr'],note='Rohre is the plural of Rohr; Röhre is a separate singular noun. Broad citation forms shown; German r realizations vary by speaker.'),
   pair('de-rote-roete',('rote','ˈʁoːtə','red, inflected','ʁ oː t ə'),('Röte','ˈʁøːtə','redness','ʁ øː t ə'),duden('rot','Roete')+['https://dictionary.cambridge.org/dictionary/german-english/rot'],note='Rote is an inflected adjective form; Röte is a noun. Both have first-syllable stress.'),
  ],[de_source])
])

es_source='https://doi.org/10.1017/S0025100316000232'
language('es','Spanish','Español','es-MX','Mexican Spanish; starter contrasts also occur widely elsewhere','Hear the difference in a tap, a trill or a stressed syllable.',[
 contrast('es-tap-trill','Caro or carro?',['ɾ','r'],
  'Between vowels, the single tap in caro and the trill in carro can distinguish words. Match the consonant category across different words; no spoken response is required.',[
   pair('es-caro-carro',('caro','ˈkaɾo','expensive','k a ɾ o'),('carro','ˈkaro','car; cart','k a r o'),rae('caro','carro')),
   pair('es-pero-perro',('pero','ˈpeɾo','but','p e ɾ o'),('perro','ˈpero','dog','p e r o'),rae('pero','perro')),
   pair('es-coro-corro',('coro','ˈkoɾo','choir','k o ɾ o'),('corro','ˈkoro','I run','k o r o'),rae('coro','correr')),
  ],[es_source,'https://www.fundeu.es/noticia/la-erre/']),
 contrast('es-p-b','Peso or beso?',['p','b'],
  'Listen to the first consonant. These citation forms begin after a pause; Spanish b may sound softer in the middle of a phrase.',[
   pair('es-peso-beso',('peso','ˈpeso','weight; peso','p e s o'),('beso','ˈbeso','kiss','b e s o'),rae('peso','beso')),
   pair('es-pata-bata',('pata','ˈpata','animal leg; paw','p a t a'),('bata','ˈbata','robe','b a t a'),rae('pata','bata')),
   pair('es-pala-bala',('pala','ˈpala','shovel','p a l a'),('bala','ˈbala','bullet','b a l a'),rae('pala','bala')),
  ],[es_source]),
 contrast('es-stress','Hablo or habló?',['first-syllable stress','last-syllable stress'],
  'The same sequence of sounds can have different word stress. Listen for which syllable is prominent; these are stress contrasts rather than consonant or vowel substitutions.',[
   pair('es-hablo-hablo-past',('hablo','ˈablo','I speak','a b l o'),('habló','aˈblo','he/she/you formal spoke','a b l o'),rae('hablar'),kind='stress'),
   pair('es-canto-canto-past',('canto','ˈkanto','I sing','k a n t o'),('cantó','kanˈto','he/she/you formal sang','k a n t o'),rae('cantar'),kind='stress'),
   pair('es-tomo-tomo-past',('tomo','ˈtomo','I take','t o m o'),('tomó','toˈmo','he/she/you formal took','t o m o'),rae('tomar'),kind='stress'),
  ],[es_source])
])

it_source='https://ricerca.sns.it/retrieve/bf9bc2cf-6ebc-4f8b-a0fc-6f081b2d64e4/98_Bertinetto%26Loporcaro_Italian_JIPA_post%20review.pdf'
language('it','Italian','Italiano','it-IT','Standard Italian','Catch consonant length and small changes in familiar words.',[
 contrast('it-length','Pala or palla?',['single consonant','long consonant'],
  'A longer consonant can change an Italian word. Listen to the whole timing pattern: the preceding vowel can change duration too.',[
   pair('it-pala-palla',('pala','ˈpala','shovel','p a l a'),('palla','ˈpalːa','ball','p a lː a'),treccani('pala','palla')),
   pair('it-fato-fatto',('fato','ˈfato','fate','f a t o'),('fatto','ˈfatːo','fact; done','f a tː o'),treccani('fato','fatto')+[it_source]),
   pair('it-pena-penna',('pena','ˈpena','sorrow; penalty','p e n a'),('penna','ˈpenːa','pen; feather','p e nː a'),treccani('pena','penna')),
  ],[it_source],[{'nativeLanguage':'en','note':'Double letters in English do not usually work this way. In Italian, listen for consonant duration inside the word.'}]),
 contrast('it-f-v','Fino or vino?',['f','v'],
  'Compare the unvoiced f with the voiced v at the beginning of the word.',[
   pair('it-fino-vino',('fino','ˈfino','fine; thin','f i n o'),('vino','ˈvino','wine','v i n o'),treccani('fino','vino')),
   pair('it-faro-varo',('faro','ˈfaro','lighthouse','f a r o'),('varo','ˈvaro','launching a vessel','v a r o'),treccani('faro','varo')),
   pair('it-finto-vinto',('finto','ˈfinto','fake; pretended','f i n t o'),('vinto','ˈvinto','won; defeated','v i n t o'),treccani('finto','vinto')),
  ],[it_source]),
 contrast('it-p-b','Panca or banca?',['p','b'],
  'Listen to the first sound while the remainder of the word stays the same.',[
   pair('it-panca-banca',('panca','ˈpanka','bench','p a n k a'),('banca','ˈbanka','bank','b a n k a'),treccani('panca','banca')),
   pair('it-pasta-basta',('pasta','ˈpasta','pasta; dough','p a s t a'),('basta','ˈbasta','enough!','b a s t a'),treccani('pasta','bastare')),
   pair('it-pelle-belle',('pelle','ˈpɛlːe','skin','p ɛ lː e'),('belle','ˈbɛlːe','beautiful, feminine plural','b ɛ lː e'),treccani('pelle','bello')),
  ],[it_source])
])

zh_source='https://assets.cambridge.org/97805216/03980/excerpt/9780521603980_excerpt.htm'
zh_tone_source='https://www.open.edu/openlearn/mod/oucontent/view.php?id=106435&section=2'
def zhlex(*words): return ['https://www.mdbg.net/chinese/dictionary?page=worddict&wdrst=0&wdqb='+quote(w) for w in words]
language('zh','Mandarin Chinese','普通话','zh-CN','Standard Mandarin (Putonghua), isolated citation tones','Hear how a tone changes the meaning of a syllable.',[
 contrast('zh-tone-1-4','Level or falling?',['tone 1','tone 4'],
  'Tone 1 stays relatively high and level; tone 4 falls. Judge the contour within the speaker’s own range, not an absolute musical pitch.',[
   pair('zh-ma1-ma4',('妈','ma˥','mother','m a T1','mā'),('骂','ma˥˩','scold','m a T4','mà'),zhlex('妈','骂')+[zh_source],kind='tone'),
   pair('zh-shu1-shu4',('书','ʂu˥','book','ʂ u T1','shū'),('树','ʂu˥˩','tree','ʂ u T4','shù'),zhlex('书','树'),kind='tone'),
   pair('zh-tang1-tang4',('汤','tʰɑŋ˥','soup','tʰ ɑ ŋ T1','tāng'),('烫','tʰɑŋ˥˩','scalding; to scald','tʰ ɑ ŋ T4','tàng'),zhlex('汤','烫'),kind='tone'),
  ],[zh_source,zh_tone_source]),
 contrast('zh-tone-2-3','Rising or low?',['tone 2','tone 3'],
  'Tone 2 rises. Tone 3 is low and may dip and rise when spoken alone. In connected speech tone 3 often stays low, and a following third tone changes its realization.',[
   pair('zh-ma2-ma3',('麻','ma˧˥','hemp; numb','m a T2','má'),('马','ma˨˩˦','horse','m a T3','mǎ'),zhlex('麻','马')+[zh_source],kind='tone'),
   pair('zh-yu2-yu3',('鱼','y˧˥','fish','y T2','yú'),('雨','y˨˩˦','rain','y T3','yǔ'),zhlex('鱼','雨'),kind='tone',note='雨 is the noun rain here; some compound/verb readings differ.'),
   pair('zh-pi2-pi3',('皮','pʰi˧˥','skin','pʰ i T2','pí'),('匹','pʰi˨˩˦','measure word for horses','pʰ i T3','pǐ'),zhlex('皮','匹'),kind='tone'),
  ],[zh_source,zh_tone_source],[{'nativeLanguage':'en','note':'Pitch is part of word identity here, not only question or emotion. Practice without trying to reproduce it yet.'}]),
 contrast('zh-tone-1-2','Level or rising?',['tone 1','tone 2'],
  'Compare a relatively level high tone with a rising contour. The consonants and vowels are unchanged within each pair.',[
   pair('zh-ma1-ma2',('妈','ma˥','mother','m a T1','mā'),('麻','ma˧˥','hemp; numb','m a T2','má'),zhlex('妈','麻')+[zh_source],kind='tone'),
   pair('zh-shi1-shi2',('诗','ʂɻ̩˥','poem','ʂ ɻ̩ T1','shī'),('十','ʂɻ̩˧˥','ten','ʂ ɻ̩ T2','shí'),zhlex('诗','十'),kind='tone',note='The syllabic sound after sh is transcribed differently across phonological analyses; both words share it.'),
   pair('zh-ba1-ba2',('八','pa˥','eight','p a T1','bā'),('拔','pa˧˥','pull out','p a T2','bá'),zhlex('八','拔'),kind='tone'),
  ],[zh_source,zh_tone_source])
])

pt_source='https://www.cambridge.org/core/journals/journal-of-the-international-phonetic-association/article/brazilian-portuguese/8EE69D52AE2D06C1EDA2841EA2E14FEC'
language('pt','Portuguese','Português','pt-BR','Brazilian Portuguese','Separate close consonants in Brazilian Portuguese.',[
 contrast('pt-f-v','Faca or vaca?',['f','v'],
  'Listen for the change from an unvoiced f to a voiced v. The words share the rest of their sound pattern.',[
   pair('pt-faca-vaca',('faca','ˈfaka','knife','f a k a'),('vaca','ˈvaka','cow','v a k a'),priberam('faca','vaca')),
   pair('pt-fila-vila',('fila','ˈfila','queue; line','f i l a'),('vila','ˈvila','small town','v i l a'),priberam('fila','vila')),
   pair('pt-fala-vala',('fala','ˈfala','speech; speaks','f a l a'),('vala','ˈvala','ditch','v a l a'),priberam('fala','vala')),
  ],[pt_source]),
 contrast('pt-s-z','Caça or casa?',['s','z'],
  'Between vowels, these examples contrast an s-like hiss and a z-like buzz. Pay attention to the sound rather than guessing from one letter.',[
   pair('pt-caca-casa',('caça','ˈkasa','hunt; game animals','k a s a'),('casa','ˈkaza','house','k a z a'),priberam('caça','casa')),
   pair('pt-assa-asa',('assa','ˈasa','roasts','a s a'),('asa','ˈaza','wing','a z a'),priberam('assar','asa')),
   pair('pt-caco-caso',('caço','ˈkasu','I hunt','k a s u'),('caso','ˈkazu','case; if','k a z u'),priberam('caçar','caso')),
  ],[pt_source],[{'nativeLanguage':'es','note':'Portuguese distinguishes /s/ and /z/ in these words. Similar-looking spelling is not a reliable substitute for listening.'}]),
 contrast('pt-p-b','Pata or bata?',['p','b'],
  'Compare the consonant at the beginning of each word. Start with isolated words before moving to phrases.',[
   pair('pt-pata-bata',('pata','ˈpata','paw; female duck','p a t a'),('bata','ˈbata','smock; robe','b a t a'),priberam('pata','bata')),
   pair('pt-pala-bala',('pala','ˈpala','visor; peak of a cap','p a l a'),('bala','ˈbala','candy; bullet','b a l a'),priberam('pala','bala')),
   pair('pt-pato-bato',('pato','ˈpatu','duck','p a t u'),('bato','ˈbatu','I hit; I beat','b a t u'),priberam('pato','bater')),
  ],[pt_source])
])

ru_source='https://doi.org/10.1017/S0025100314000395'
language('ru','Russian','Русский','ru-RU','Contemporary Standard Russian','Hear hard and soft consonants and contrasting word beginnings.',[
 contrast('ru-hard-soft','Лук or люк?',['plain consonant','palatalized consonant'],
  'A soft consonant includes a tongue movement toward the hard palate. It is not simply an extra separate y syllable. The target consonant can occur at either end of a word.',[
   pair('ru-luk-lyuk',('лук','luk','onion; bow','l u k'),('люк','lʲuk','hatch','lʲ u k'),gramota('лук','люк')),
   pair('ru-nos-nyos',('нос','nos','nose','n o s'),('нёс','nʲos','carried, masculine past','nʲ o s'),gramota('нос','нести')),
   pair('ru-mat-matsoft',('мат','mat','checkmate; mat','m a t'),('мать','matʲ','mother','m a tʲ'),gramota('мат','мать'),note='Мат has several meanings, including profanity as a category; the starter gloss here is checkmate/mat.'),
   pair('ru-ugol-ugolsoft',('угол','ˈuɡol','corner; angle','u ɡ o l'),('уголь','ˈuɡolʲ','coal','u ɡ o lʲ'),gramota('угол','уголь'),note='Broad phonemic transcription. The unstressed second vowel is reduced in actual speech.'),
  ],[ru_source],[{'nativeLanguage':'en','note':'English does not use this hard/soft opposition in the same systematic way. Learn it by the full recorded contrast, not spelling alone.'}]),
 contrast('ru-s-sh','Сок or шок?',['s','ʂ'],
  'Compare the hiss at the start of сок with the darker, retracted sound at the start of шок. Russian ш is conventionally hard.',[
   pair('ru-sok-shok',('сок','sok','juice','s o k'),('шок','ʂok','shock','ʂ o k'),gramota('сок','шок')),
   pair('ru-sutki-shutki',('сутки','ˈsutkʲi','a 24-hour period','s u t kʲ i'),('шутки','ˈʂutkʲi','jokes','ʂ u t kʲ i'),gramota('сутки','шутка'),note='Broad phonemic transcription; final unstressed и is normally more centralized in the recording.'),
  ],[ru_source]),
 contrast('ru-d-t','Дом or том?',['d','t'],
  'Listen to the consonant at the beginning of the word. These are initial contrasts; Russian final devoicing needs its own lesson.',[
   pair('ru-dom-tom',('дом','dom','house; home','d o m'),('том','tom','volume of a book','t o m'),gramota('дом','том')),
   pair('ru-dochka-tochka',('дочка','ˈdotɕka','daughter','d o tɕ k a'),('точка','ˈtotɕka','point; dot','t o tɕ k a'),gramota('дочка','точка'),note='Broad phonemic transcription; final unstressed а is reduced in the recording.'),
  ],[ru_source])
])

from french_expansion import add_french_expansion
add_french_expansion(LANGUAGES,contrast,pair,fr_source)
from french_legacy_batch2 import add_french_legacy_batch2
add_french_legacy_batch2(LANGUAGES,contrast,pair,fr_source)
from english_legacy_batch1 import add_english_legacy_batch1
add_english_legacy_batch1(LANGUAGES,contrast,pair,en_source)

# A/B display order may be randomized; word index remains a stable sound category.
ABX_FOCUS = json.loads((ROOT/'abx-focus.json').read_text())
for lang in LANGUAGES:
    for item in lang['contrasts']:
        focus = ABX_FOCUS[item['id']]
        item['targetSoundFocus'] = focus['targetSoundFocus']
        item['abx'] = dict(focus,
            prompt=('Which reference shares X’s target feature?' if focus['matchType']=='feature' else
                    'Which reference shares X’s stress pattern?' if focus['matchType']=='stress' else
                    'Which reference shares X’s tone?' if focus['matchType']=='tone' else
                    'Which reference shares X’s target sound?'),
            categoryLabels=item['phonemes'], categoryOrder='words[0] is category 0; words[1] is category 1',
            xMustUseDifferentPair=True, xMustExcludeBothReferenceWordTexts=True,
            presentation='audio-only-until-answer-or-explicit-text-assist')
        for example in item['pairs']:
            a,b=example['words']
            changes=[i for i,(x,y) in enumerate(zip(a['phonemes'],b['phonemes'])) if x!=y]
            idx=changes[0] if changes else None
            position=('whole-syllable' if example['kind']=='tone' else 'word-stress' if example['kind']=='stress' else
                      'initial' if idx==0 else 'final' if idx==len(a['phonemes'])-1 else 'medial')
            example['abx']=dict(categoryByWordIndex=[0,1], targetTokenIndex=idx, targetPosition=position,
                trialGroup=position if focus.get('requireSameTargetPosition') else 'all')
            if example['kind']=='stress': example['abx']['syllableCounts']=[2,2]

output = dict(schemaVersion='1.1.0',updatedAt='2026-09-28',
    status='starter-text-curation',languages=LANGUAGES,
    editorialPolicy={
        'ipa':'Broad teaching transcriptions. Predictable phonetic variation is not a second phonemic contrast. Audio must match the declared dialect and target word.',
        'sources':'Reference links identify lexemes and phonological descriptions; they are not licenses to reuse source audio or prose. Some linked dictionary pages require interactive access. See source-audit.json for actual verification state.',
        'definitions':'Short original English learning glosses, not copied dictionary definitions.',
        'l1':'L1 notes are optional guidance; observed performance, not nationality or native language, controls difficulty.',
        'claims':'No recording in this file is certified human-recorded, natural or correct. Text curation is separate from audio review.',
        'scope':'Eight starter libraries. This is not all contrasts or all minimal pairs in any language.'})
(ROOT/'curriculum.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print('Wrote',len(LANGUAGES),'languages,',sum(len(l['contrasts']) for l in LANGUAGES),'contrasts,',sum(len(c['pairs']) for l in LANGUAGES for c in l['contrasts']),'pairs')
