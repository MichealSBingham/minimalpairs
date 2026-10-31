import { analyzeLive } from './live-analysis.mjs';
self.onmessage=({data})=>{
  const start=performance.now();
  try { self.postMessage({...analyzeLive(data.samples,data.sampleRate),at:data.at,ms:performance.now()-start}); }
  catch { self.postMessage({ok:false,reason:'Could not locate this sound',at:data.at,ms:performance.now()-start}); }
};
