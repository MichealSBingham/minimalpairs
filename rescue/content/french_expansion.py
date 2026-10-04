"""Additional French contrasts, scoped to the stated reference variety."""
from urllib.parse import quote
MID_VOWEL_SOURCE='https://www.cambridge.org/core/journals/journal-of-french-language-studies/article/diachronic-evolution-of-e-e-o-o-in-french-across-100-years-of-speech-archives/782DF1C3A3049CF8A43F4CD5C9F6E65A'
SOUTHERN_SOURCE='https://julieneychenne.info/files/pdf/Eychenne2014_JFLS_VF.pdf'
def lex(*words):
    pos={'cote':'nom','teint':'nom','ton':'nom','pan':'nom','prêt':'adjectif','sot':'adjectif','chou':'nom','bain':'nom','banc':'nom','boule':'nom'}
    return ['https://www.portail-lexical.fr/definition/tlfi/'+quote(w)+('/'+pos[w] if w in pos else '') for w in words]
def add_french_expansion(languages,contrast,pair,fr_source):
    added=[
      contrast('fr-e-e-open','Pré or prêt?',['e','ɛ'],
        'Compare close-mid and open-mid front vowels in a northern reference variety. Some speakers merge these word-final categories; that is regional variation, not a learner error.',[
          pair('fr-pre-pret',('pré','pʁe','meadow','p ʁ e'),('prêt','pʁɛ','ready','p ʁ ɛ'),lex('pré','prêt')),
          pair('fr-the-taie',('thé','te','tea','t e'),('taie','tɛ','pillowcase','t ɛ'),lex('thé','taie')),
          pair('fr-de-dais',('dé','de','a die; one of a pair of dice','d e'),('dais','dɛ','ceremonial canopy','d ɛ'),lex('dé','dais'),note='Dais is a less frequent but established noun. The task does not require knowing its meaning.'),
        ],[fr_source,MID_VOWEL_SOURCE,SOUTHERN_SOURCE]),
      contrast('fr-in-on','Bain or bon?',['ɛ̃','ɔ̃'],
        'Listen to the quality of the nasal vowel. The starter words end in the vowel itself, without a separate final n.',[
          pair('fr-bain-bon',('bain','bɛ̃','bath','b ɛ̃'),('bon','bɔ̃','good','b ɔ̃'),lex('bain','bon')),
          pair('fr-pin-pont',('pin','pɛ̃','pine tree','p ɛ̃'),('pont','pɔ̃','bridge','p ɔ̃'),lex('pin','pont')),
          pair('fr-teint-ton',('teint','tɛ̃','complexion','t ɛ̃'),('ton','tɔ̃','tone','t ɔ̃'),lex('teint','ton')),
        ],[fr_source]),
      contrast('fr-an-in','Banc or bain?',['ɑ̃','ɛ̃'],
        'Compare two nasal vowel categories across different first consonants. Keep your attention on vowel quality; both sides are nasal.',[
          pair('fr-banc-bain',('banc','bɑ̃','bench','b ɑ̃'),('bain','bɛ̃','bath','b ɛ̃'),lex('banc','bain')),
          pair('fr-pan-pain',('pan','pɑ̃','section; panel','p ɑ̃'),('pain','pɛ̃','bread','p ɛ̃'),lex('pan','pain')),
          pair('fr-temps-teint',('temps','tɑ̃','time; weather','t ɑ̃'),('teint','tɛ̃','complexion','t ɛ̃'),lex('temps','teint')),
        ],[fr_source]),
      contrast('fr-o-o-open','Paume or pomme?',['o','ɔ'],
        'Compare two rounded mid vowels before a final consonant. These pairs retain a vowel-quality distinction in the northern reference variety used here; many southern varieties merge it.',[
          pair('fr-paume-pomme',('paume','pom','palm of the hand','p o m'),('pomme','pɔm','apple','p ɔ m'),lex('paume','pomme'),note='Traditional descriptions may mark a longer vowel in paume. Listen to quality together with natural timing.'),
          pair('fr-cote-cote',('côte','kot','coast; rib','k o t'),('cote','kɔt','rating; assessed value','k ɔ t'),lex('côte','cote')),
          pair('fr-saute-sotte',('saute','sot','a sudden change','s o t'),('sotte','sɔt','foolish, feminine','s ɔ t'),lex('saute','sot'),note='Saute is the noun in une saute de vent; sotte is the feminine form of sot. Both are citation forms without an added final schwa.'),
        ],[fr_source,MID_VOWEL_SOURCE,SOUTHERN_SOURCE]),
      contrast('fr-b-p','Beau or peau?',['b','p'],
        'Compare the first consonant in each word. The vowel or following syllable stays the same within a reference pair.',[
          pair('fr-beau-peau',('beau','bo','beautiful; handsome','b o'),('peau','po','skin','p o'),lex('beau','peau')),
          pair('fr-bain-pain',('bain','bɛ̃','bath','b ɛ̃'),('pain','pɛ̃','bread','p ɛ̃'),lex('bain','pain')),
          pair('fr-boule-poule',('boule','bul','ball; sphere','b u l'),('poule','pul','hen','p u l'),lex('boule','poule')),
        ],[fr_source]),
      contrast('fr-zh-sh','Joue or chou?',['ʒ','ʃ'],
        'Listen for the voiced and voiceless consonants at the beginning. Match the opening sound in X while the vowel changes between examples.',[
          pair('fr-joue-chou',('joue','ʒu','cheek','ʒ u'),('chou','ʃu','cabbage','ʃ u'),lex('joue','chou')),
          pair('fr-gens-champ',('gens','ʒɑ̃','people','ʒ ɑ̃'),('champ','ʃɑ̃','field','ʃ ɑ̃'),lex('gens','champ')),
          pair('fr-geai-chai',('geai','ʒɛ','jay, a bird','ʒ ɛ'),('chai','ʃɛ','wine storehouse','ʃ ɛ'),lex('geai','chai')),
        ],[fr_source]),
    ]
    for c in added:
        c['dialect']='Northern metropolitan reference French; mid-vowel distinctions explicitly retained' if c['id'] in ['fr-e-e-open','fr-o-o-open'] else 'Metropolitan French citation forms'
    next(l for l in languages if l['id']=='fr')['contrasts'].extend(added)
