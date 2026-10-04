import type { Language, PracticeSession } from './ui';
import { Icon } from './ui';
import { courseProgress, type CourseMode } from '../lib/course-progress';
import { courseText } from '../lib/course-i18n';
import '../styles/course-progress.css';
export default function CourseProgress({locale='en',language,sessions,fullAccess,onStart,disabled=false}: {locale?:string;language:Language;sessions:PracticeSession[];fullAccess:boolean;onStart:(contrastId:string,mode:CourseMode)=>void;disabled?:boolean}) {
 const t=(i:number)=>courseText(locale,i);
 const progress=courseProgress(language.contrasts,sessions,language.id,fullAccess);
 const label=(mode:CourseMode)=>t(mode==='abx-cross-word'?2:3);
 const sounds=(phonemes:string[])=>phonemes.map(p=>`/${p}/`).join(' · ');
 const next=progress.next;
 const unit=Math.floor((next?.index??0)/3);
 return <section className="course-progress" aria-label={t(0)}>
  <div className="course-top"><div><span className="eyebrow">{t(0)}</span><h2>{t(1)}</h2></div><span>{progress.completed}/{progress.steps.length} {t(6)}</span></div>
  <div className="course-meter" role="progressbar" aria-label={t(6)} aria-valuemin={0} aria-valuemax={progress.steps.length} aria-valuenow={progress.completed}><span style={{width:`${100*progress.completed/Math.max(1,progress.steps.length)}%`}}/></div>
  <div className="course-current"><div><small>{t(7)} {unit+1}{next ? ` · ${t(8)} ${next.index+1}`:''}</small><strong>{next ? sounds(next.contrast.phonemes) : t(18)}</strong><span>{next?label(next.mode):t(16)}</span></div><div className="course-two-steps" aria-hidden="true"><span className={next?.mode==='word-identification'?'done':'active'}>1 <Icon name="headphones" size={20}/></span><i/><span className={next?.mode==='word-identification'?'active':''}>2 <Icon name="book" size={20}/></span></div></div>
  {next && <button className="button button-dark" disabled={disabled} onClick={()=>onStart(next.contrast.id,next.mode)}>{progress.completed?t(5):t(4)}<Icon name="arrow"/></button>}
  <details className="course-all"><summary>{t(15)}</summary><ol>{language.contrasts.map((c,index)=><li key={c.id}><span className="course-lesson-number">{index+1}</span><div><strong>{sounds(c.phonemes)}</strong><div className="course-lesson-actions">{progress.steps.filter(s=>s.contrast.id===c.id).map(s=><button key={s.mode} disabled={disabled||s.locked} onClick={()=>onStart(c.id,s.mode)}><Icon name={s.locked?'lock':s.completed?'check':s.mode==='abx-cross-word'?'headphones':'book'} size={14}/>{label(s.mode)}<span className="course-sr"> · {s.locked?t(17):s.completed?t(16):t(14)}</span></button>)}</div></div></li>)}</ol></details>
  <details className="course-charts" open={progress.trends.some(g=>g.sessions.length>0)}><summary>{t(9)}</summary>
   {!progress.trends.some(g=>g.sessions.length>0)?<p>{t(13)}</p>:<><div className="course-trends">{progress.trends.filter(g=>g.sessions.length).map(g=><div key={g.mode}><h3>{label(g.mode)}</h3><p>{t(10)}</p><div className="course-bars" role="img" aria-label={`${label(g.mode)}: ${g.sessions.map(s=>`${Math.round(100*s.correct/s.total)}%`).join(', ')}`}>{g.sessions.map((s,i)=><div key={s.id} title={`${new Date(s.completedAt).toLocaleDateString(locale)} · ${s.correct}/${s.total} · ${s.textHintsUsed?t(22):t(23)}`}><span>{Math.round(100*s.correct/s.total)}%</span><i style={{height:`${Math.max(3,100*s.correct/s.total)}px`}}/><small>{i+1}</small></div>)}</div><details><summary>{t(20)}</summary><ul className="course-session-list">{g.sessions.map(s=><li key={s.id}>{new Date(s.completedAt).toLocaleDateString(locale)} · {s.correct}/{s.total} {t(21)} · {s.textHintsUsed?t(22):t(23)}</li>)}</ul></details></div>)}</div>
   <div className="course-insights">{([[11,progress.needsPractice],[12,progress.strengths]] as const).filter(([,steps])=>steps.length).map(([heading,steps])=><div key={heading}><h3>{t(heading)}</h3>{steps.map(s=><button key={`${s.contrast.id}-${s.mode}`} disabled={disabled||s.locked} onClick={()=>onStart(s.contrast.id,s.mode)}><span>{sounds(s.contrast.phonemes)}<small>{label(s.mode)}</small></span><strong>{Math.round(s.rate!*100)}%</strong><Icon name="arrow" size={15}/></button>)}</div>)}</div></>}
  </details>
  {progress.mistakes.length>0 && <details className="course-all"><summary>{t(24)}</summary><ul className="course-mistakes">{progress.mistakes.map((m,i)=><li key={`${m.contrastId}-${i}`}><div><small>{label(m.mode)}</small><span>{t(25)}: <strong>{m.word}</strong></span><span>{t(26)}: <strong>{m.chosenWord}</strong></span></div><button className="text-button" disabled={disabled||progress.steps.some(s=>s.contrast.id===m.contrastId&&s.locked)} onClick={()=>onStart(m.contrastId,m.mode)}>{t(27)} <Icon name="arrow" size={14}/></button></li>)}</ul></details>}
 </section>;
}
