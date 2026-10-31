// Baseline v1: band-limited resampling, periodicity gate, autocorrelation LPC.
// This estimates acoustic resonances; it does not classify vowels or accents.
export function resample(input, sr, target=12000){
 if(sr===target)return Float64Array.from(input);
 const n=Math.floor(input.length*target/sr),out=new Float64Array(n),cut=Math.min(1,target/sr)*.88;
 for(let j=0;j<n;j++){
  const p=j*sr/target,c=Math.floor(p);let total=0,weight=0;
  for(let k=c-20;k<=c+20;k++){if(k<0||k>=input.length)continue;const d=p-k,z=Math.PI*d*cut;
   const w=(Math.abs(z)<1e-9?cut:Math.sin(z)/(Math.PI*d))*(.5+.5*Math.cos(Math.PI*d/21));
   total+=input[k]*w;weight+=w;
  }out[j]=total/(weight||1);
 }return out;
}
function lpc(x,order){
 const r=new Float64Array(order+1);
 for(let lag=0;lag<=order;lag++)for(let i=lag;i<x.length;i++)r[lag]+=x[i]*x[i-lag];
 r[0]*=1.00001;const a=new Float64Array(order+1);a[0]=1;let err=r[0];
 if(err<1e-12)return null;
 for(let i=1;i<=order;i++){
  let sum=r[i];for(let j=1;j<i;j++)sum+=a[j]*r[i-j];
  const k=-sum/err;if(!Number.isFinite(k)||Math.abs(k)>=1)return null;
  const old=a.slice();a[i]=k;for(let j=1;j<i;j++)a[j]=old[j]+k*old[i-j];
  err*=1-k*k;
 }return a;
}
// Solve the LPC polynomial for resonant pole pairs, including broad/merged peaks.
function candidates(x,order,sr){
 const a=lpc(x,order);if(!a)return [];
 const roots=Array.from({length:order},(_,k)=>{const angle=2*Math.PI*(k+.25)/order;return [.94*Math.cos(angle),.94*Math.sin(angle)];});
 let converged=false;
 for(let iteration=0;iteration<150;iteration++){
  let maxMove=0;
  for(let i=0;i<order;i++){
   const [zr,zi]=roots[i];let pr=1,pi=0;
   for(let k=1;k<=order;k++){const nr=pr*zr-pi*zi+a[k];pi=pr*zi+pi*zr;pr=nr;}
   let dr=1,di=0;
   for(let j=0;j<order;j++){if(j===i)continue;const re=zr-roots[j][0],im=zi-roots[j][1],nr=dr*re-di*im;di=dr*im+di*re;dr=nr;}
   const den=dr*dr+di*di;if(den<1e-28)return [];
   const mr=(pr*dr+pi*di)/den,mi=(pi*dr-pr*di)/den;
   roots[i]=[zr-mr,zi-mi];maxMove=Math.max(maxMove,Math.hypot(mr,mi));
  }
  if(maxMove<1e-8){converged=true;break;}
 }
 if(!converged)return [];
 return roots.filter(([re,im])=>im>0).map(([re,im])=>({f:Math.atan2(im,re)*sr/(2*Math.PI),bw:-Math.log(Math.hypot(re,im))*sr/Math.PI})).filter(p=>p.f>150&&p.f<4000&&p.bw>15&&p.bw<700).sort((a,b)=>a.f-b.f);
}
export function analyze(input,sr){
 let energy=0,clipped=0;for(const v of input){energy+=v*v;if(Math.abs(v)>.985)clipped++;}
 const rms=Math.sqrt(energy/(input.length||1));const fail=reason=>({ok:false,reason,rms});
 if(input.length<sr*.035)return fail('Need a longer sound');
 if(rms<.003)return fail('Waiting for a steady vowel');
 if(clipped/input.length>.01)return fail('Too loud — move back a little');
 const x=resample(input,sr);const rate=12000;let mean=x.reduce((s,v)=>s+v,0)/x.length;
 for(let i=0;i<x.length;i++)x[i]-=mean;
 // Normalized autocorrelation checks periodicity, not vowel identity.
 let periodicity=0;
 for(let lag=Math.floor(rate/450);lag<=Math.floor(rate/70);lag+=2){
  let cross=0,a=0,b=0;for(let i=lag;i<x.length;i+=2){cross+=x[i]*x[i-lag];a+=x[i]*x[i];b+=x[i-lag]*x[i-lag];}
  periodicity=Math.max(periodicity,cross/Math.sqrt(a*b+1e-20));
 }
 if(periodicity<.60)return {...fail('Hold a clear, steady vowel'),periodicity};
 const pre=new Float64Array(x.length);for(let i=1;i<x.length;i++)pre[i]=(x[i]-.97*x[i-1])*(.54-.46*Math.cos(2*Math.PI*i/(x.length-1)));
 const estimates=[];
 for(const order of [12,14,16]){
  const peaks=candidates(pre,order,rate).filter(p=>p.f>180);
  if(peaks.length<2)continue;
  const f1=peaks[0].f,f2=peaks[1].f;
  if(f1<1200&&f2>f1+180&&f2<3500)estimates.push({f1,f2,order});
 }
 // Require two analysis orders to agree; never force a dot toward a prompted vowel.
 let best=null,bestD=Infinity;
 for(let i=0;i<estimates.length;i++)for(let j=i+1;j<estimates.length;j++){
  const a=estimates[i],b=estimates[j],d=Math.abs(a.f1-b.f1)/100+Math.abs(a.f2-b.f2)/180;
  if(d<bestD){bestD=d;best={f1:(a.f1+b.f1)/2,f2:(a.f2+b.f2)/2};}
 }
 if(!best||bestD>2.2)return {...fail('Vowel position unclear — try again'),periodicity};
 return {ok:true,reason:'Following your sound',...best,rms,periodicity,agreement:bestD};
}
