// An optional background observation collected while listening, never a forced
// opening countdown. It is a heuristic: other voices/processed audio can evade it.
export class BackgroundGuard {
  constructor(){this.floor=null;this.quiet=[];}
  apply(result,at){
    const unvoiced=result.rms<.003||result.periodicity<.5;
    if(unvoiced){
      this.quiet.push({at,rms:result.rms});
      this.quiet=this.quiet.filter(p=>at-p.at<=800);
      if(this.quiet.length>=8&&at-this.quiet[0].at>=400){
        const levels=this.quiet.map(p=>p.rms).sort((a,b)=>a-b);
        this.floor=levels[Math.floor(levels.length/2)];
      }
    }else this.quiet=[];
    const margin=this.floor===null?null:20*Math.log10(Math.max(result.rms,1e-8)/Math.max(this.floor,1e-6));
    if(result.ok&&margin!==null&&margin<20)return {...result,ok:false,reason:'Sound too close to the background level — try a quieter spot',backgroundMarginDb:margin};
    return {...result,backgroundMarginDb:margin};
  }
}
