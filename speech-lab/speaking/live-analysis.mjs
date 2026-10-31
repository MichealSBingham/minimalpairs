// Exploratory fast path. Historical baseline is copied unchanged; no vowel target
// or word is an input. Agreement between LPC orders is not calibrated confidence.
import { analyze, resample } from './live-baseline.mjs';

export function analyzeLive(samples, sampleRate) {
  let clipped=0;for(const s of samples)if(Math.abs(s)>.985)clipped++;
  if(clipped/samples.length>.01)return {ok:false,reason:'Too loud — move back a little',rms:Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length)};
  // Pure tones can be highly periodic but are not evidence of a vowel. A single
  // sinusoid obeys x[n]+x[n-2] = 2*cos(w)*x[n-1]; reject near-exact fits.
  // Run this at a fixed rate. At high input rates nearly any smooth waveform
  // can look like a sinusoid over adjacent samples.
  const check=resample(samples,sampleRate);
  let xy=0,xx=0,yy=0,sx=0,sy=0,n=0;
  // Ignore resampler edge transients and fit an intercept as well as the slope.
  for(let i=34;i<check.length-32;i++){
    const a=check[i-1],b=check[i]+check[i-2];
    xy+=a*b;xx+=a*a;yy+=b*b;sx+=a;sy+=b;n++;
  }
  if(n){xy-=sx*sy/n;xx-=sx*sx/n;yy-=sy*sy/n;}
  const residual=yy ? Math.max(0,yy-xy*xy/(xx||1))/yy : 0;
  if(xx>1e-8&&residual<1e-5)return {ok:false,reason:'A tone is not enough to locate a vowel',rms:Math.sqrt(xx/check.length)};
  return analyze(samples,sampleRate);
}
