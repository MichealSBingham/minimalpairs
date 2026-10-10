import DiagnosticEntry from './DiagnosticEntry';
import ListeningDemo from './ListeningDemo';
import '../styles/home-redesign.css';
import { Footer, Header, Icon, type Language } from './ui';

const previewSound = (sound = '') => ({ 'single consonant': 'short', 'long consonant': 'long', 'plain consonant': 'hard', 'palatalized consonant': 'soft' }[sound] || (sound.includes(' ') ? sound : `/${sound}/`));


export default function HomeExperience({ languages = [] }: { languages: Language[] }) {
  const ordered = [...languages].sort((a, b) => ['fr', 'es', 'de', 'it', 'ru', 'zh', 'pt', 'en', 'ja', 'en-GB-ssbe'].indexOf(a.id) - ['fr', 'es', 'de', 'it', 'ru', 'zh', 'pt', 'en', 'ja', 'en-GB-ssbe'].indexOf(b.id));
  return <><Header /><main className="redesign-home">
    <section className="rd-hero section-wrap">
      <div className="rd-hero-copy"><p className="eyebrow">EAR TRAINING FOR LANGUAGE LEARNERS</p>
        <h1>You can read it.<br /><em>Now learn to<br className="rd-desktop-break" /> hear it.</em></h1>
        <p className="rd-lede">Know the word on the page, but miss it in conversation? Start with the small sound differences that change what you hear.</p>
        <div className="rd-actions"><a className="button button-dark" href="/practice">Start free practice <Icon name="arrow" size={18} /></a><a className="button button-light" href="#listening-check">Find my starting point</a></div>
        
      </div>
      <div className="rd-hero-demo">{languages.length > 0 && <ListeningDemo language={languages.find(l=>l.id==='fr') || languages[0]} />}<p className="rd-demo-footnote">Different words. Different voices. One sound to notice.</p></div>
    </section>
    <DiagnosticEntry languages={ordered} />
    <section className="rd-method" id="how-it-works"><div className="section-wrap">
      <div className="rd-section-heading"><h2>Hear the difference.<br /><em>Then find it again.</em></h2><p>You don’t need to know phonetics. Hear two examples, then a new word. Decide which example shares the sound you’re listening for.</p></div>
      <div className="rd-method-grid"><article><span className="rd-step-letter">A</span><h3>Hear the first example</h3><p>Listen to the word. Keep your attention on the sound the exercise points out.</p></article><article><span className="rd-step-letter">B</span><h3>Compare the other sound</h3><p>A second word changes that sound. Replay either example whenever you need.</p></article><article><span className="rd-step-letter">X</span><h3>Match it in a new word</h3><p>A different voice says a different word. Does its target sound match A or B? Choose, then get feedback.</p></article></div>
      <p className="rd-method-note">Words stay hidden while you listen. Reveal them when you choose. <a href="/method">Why we teach it this way <Icon name="arrow" size={14} /></a></p>
    </div></section>
    <section className="rd-languages section-wrap" id="languages"><div className="rd-section-heading"><h2>Find your language.<br /><em>A closer ear for each.</em></h2><p>Explore the sounds, hear the examples, then put your ears to work.</p></div>
      <div className="rd-language-grid">{ordered.map(language => { const contrast = language.contrasts[0]; return <a className="rd-language-card" href={`/${language.name.toLowerCase().replace(/\s+/g, '-')}-minimal-pairs`} key={language.id}><div className="rd-language-top"><h3>{language.name}</h3><span>{language.nativeName}</span></div><div className={"rd-phonemes" + (contrast?.phonemes.some(sound => sound.length > 4) ? " is-feature" : "")}><span>{previewSound(contrast?.phonemes[0])}</span><i>vs</i><span>{previewSound(contrast?.phonemes[1])}</span></div><div className="rd-language-bottom"><span>{language.contrasts.length} sound contrasts</span><Icon name="arrow" size={18} /></div></a>; })}</div>
    </section>
    <section className="rd-statement"><div className="section-wrap"><h2>Give a difficult sound<br /><em>your full attention.</em></h2><p>A few focused minutes. A clear next step.</p></div></section>
    <section className="rd-benefits section-wrap"><article><p className="eyebrow">LISTEN, DON’T GUESS</p><h3>Your ears get the first word.</h3><p>No spelling or translation to give the answer away. Listen again, make your choice, then check it.</p></article><article><p className="eyebrow">MORE THAN ONE VOICE</p><h3>Hear the sound beyond the speaker.</h3><p>Practice with different voices to recognize the sound across speakers.</p></article><article><p className="eyebrow">A REASON TO RETURN</p><h3>Pick up where you left off.</h3><p>Keep your session history, choose a three-session plan and revisit the sounds that need another listen.</p><a href="/account#listening-plan">Build your listening plan <Icon name="arrow" size={14} /></a></article></section>
    <section className="rd-final section-wrap"><div><p className="eyebrow">START WITH ONE SOUND</p><h2>Less reading about it.<br /><em>More hearing it.</em></h2><p>Your first session is free. Choose a language and press play.</p></div><a className="button button-dark" href="/practice">Find your first sound <Icon name="arrow" size={18} /></a></section>
  </main><Footer /></>;
}
