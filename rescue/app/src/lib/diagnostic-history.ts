import type {PracticeSession} from '../components/ui';
export function diagnosticHistory(sessions:PracticeSession[],languageId:string){
 const grouped=new Map<string,PracticeSession[]>();
 for(const s of sessions){
  if(s.languageId!==languageId || !(s.purpose==='diagnostic'||s.id.startsWith('diagnostic-')) || !Number.isFinite(Date.parse(s.completedAt)) || !Number.isFinite(s.total)||s.total<=0||!Number.isFinite(s.correct)||s.correct<0||s.correct>s.total)continue;
  const rows=grouped.get(s.completedAt)||[];
  if(!rows.some(r=>r.id===s.id))rows.push(s);
  grouped.set(s.completedAt,rows);
 }
 return [...grouped].sort(([a],[b])=>Date.parse(b)-Date.parse(a)).map(([date,rows])=>({date,rows,total:rows.reduce((n,s)=>n+s.total,0),correct:rows.reduce((n,s)=>n+s.correct,0)}));
}
