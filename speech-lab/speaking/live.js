import { BackgroundGuard } from './live-quality.mjs';
// No recording, server requests or durable storage: one rolling 60 ms window.
export class LiveSession {
  constructor({onPoint,onLevel,onStatus,onDevice,onEnd}) {
    Object.assign(this,{onPoint,onLevel,onStatus,onDevice,onEnd});
    this.closed=false;this.busy=false;this.lastSent=0;this.lastSeen=0;this.background=new BackgroundGuard();
    this.stats={frames:0,accepted:0,stale:0,compute_ms:[],reasons:{},observations:[]};
  }
  async start(deviceId) {
    // Resume in the click gesture, before awaiting a permission dialog.
    try {
      this.ctx=new AudioContext();
      const resumed=this.ctx.resume();resumed.catch(()=>{});
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Open this page on localhost in a browser with microphone support.');
      const pending=navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false,...(deviceId?{deviceId:{exact:deviceId}}:{})},video:false});
      pending.then(s=>{if(this.closed)s.getTracks().forEach(t=>t.stop());},()=>{});
      const stream=await pending;
      if(this.closed)return;
      this.stream=stream;
      await Promise.race([resumed,new Promise((_,reject)=>{this.resumeTimeout=setTimeout(()=>reject(Error('Audio did not start. Stop, then try again in your browser.')),4000);})]);
      clearTimeout(this.resumeTimeout);
      if(this.closed)return;
      await this.ctx.audioWorklet.addModule('/capture.js');
      if(this.closed)return;
      const track=stream.getAudioTracks()[0];
      this.onDevice(track.label,track.getSettings());
      track.onended=()=>this.stop('The microphone disconnected. Choose an input and try again.');
      track.onmute=()=>this.onStatus('The microphone is temporarily muted.');
      this.worker=new Worker('/live-worker.js',{type:'module'});
      this.worker.onerror=()=>this.stop('The live tracker could not start. Reload this page and try again.');
      this.worker.onmessage=({data:raw})=>{
        this.busy=false;if(this.closed)return;
        if(performance.now()-raw.at>200){this.stats.stale++;return;}
        const data=this.background.apply(raw,raw.at);
        this.stats.frames++;if(this.stats.compute_ms.length<1200)this.stats.compute_ms.push(data.ms);
        if(this.stats.observations.length<1500)this.stats.observations.push({at_ms:Math.round(data.at-this.started),accepted:data.ok,
          raw_f1_hz:raw.ok?raw.f1:null,raw_f2_hz:raw.ok?raw.f2:null,
          reason:data.reason,background_margin_db:Number.isFinite(data.backgroundMarginDb)?data.backgroundMarginDb:null});
        if(data.ok){
          this.stats.accepted++;this.lastSeen=performance.now();
          // One-pole display smoothing, reset across any rejected frame. Raw
          // estimates remain in the event; smoothing is not accuracy evidence.
          const p=this.previous;
          this.previous={f1:p?.f1*.35+data.f1*.65||data.f1,f2:p?.f2*.35+data.f2*.65||data.f2};
          this.onPoint({...this.previous,raw:{f1:data.f1,f2:data.f2},at:this.lastSeen});
          this.onStatus(data.backgroundMarginDb===null?'Following your sound · background not yet checked':'Following your sound · approximate live position');
        }else{
          this.stats.reasons[data.reason]=(this.stats.reasons[data.reason]||0)+1;
          this.previous=null;this.onPoint(null);this.onStatus(data.reason);
        }
      };
      this.rate=this.ctx.sampleRate;this.window=new Float32Array(Math.round(this.rate*.06));
      this.source=this.ctx.createMediaStreamSource(stream);
      this.node=new AudioWorkletNode(this.ctx,'word-capture');
      this.node.port.onmessage=({data})=>{
        if(this.closed||!data.samples)return;
        this.lastAudio=performance.now();const samples=data.samples;
        let energy=0,clip=0;for(const v of samples){energy+=v*v;if(Math.abs(v)>.985)clip++;}
        this.onLevel(Math.sqrt(energy/samples.length),clip/samples.length);
        const n=Math.min(samples.length,this.window.length);
        this.window.copyWithin(0,n);this.window.set(samples.subarray(samples.length-n),this.window.length-n);
        this.filled=Math.min(this.window.length,(this.filled||0)+n);
        if(!this.busy&&this.filled===this.window.length&&this.lastAudio-this.lastSent>=40){
          this.busy=true;this.lastSent=this.lastAudio;
          const frame=this.window.slice();this.worker.postMessage({samples:frame,sampleRate:this.rate,at:this.lastAudio},[frame.buffer]);
        }
      };
      this.silent=this.ctx.createGain();this.silent.gain.value=0;
      this.source.connect(this.node);this.node.connect(this.silent).connect(this.ctx.destination);
      this.started=this.lastAudio=performance.now();
      this.watch=setInterval(()=>{
        if(performance.now()-this.lastSeen>220){if(this.previous)this.onStatus('Waiting for another clear vowel');this.previous=null;this.onPoint(null);}
        if(performance.now()-this.lastAudio>2500)this.stop('No audio is arriving. Check the selected microphone, its mute switch and browser permission.');
        else if(this.busy&&performance.now()-this.lastSent>1200)this.stop('The live tracker stopped responding. Please start again.');
      },80);
      this.limit=setTimeout(()=>this.stop('Live practice paused after one minute. Start again whenever you like.'),60000);
      this.onStatus('Listening. Hold a comfortable “ih”, then “ee”.');
    }catch(e){
      await this.stop(e.name==='NotAllowedError'?'Microphone access was not allowed. Enable it for this page in your browser.':e.name==='NotFoundError'?'No microphone was found. Connect one and try again.':e.message);
    }
  }
  async stop(message='Live practice paused. No audio was saved.') {
    if(this.closed)return;this.closed=true;
    clearInterval(this.watch);clearTimeout(this.limit);clearTimeout(this.resumeTimeout);
    this.worker?.terminate();this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});
    try{this.source?.disconnect();this.node?.disconnect();this.silent?.disconnect();if(this.ctx?.state!=='closed')await this.ctx?.close();}catch{}
    this.onPoint(null);this.onLevel(0,0);this.onStatus(message);
    this.onEnd({method:'experimental-browser-lpc-v1',...this.stats,duration_ms:Math.round(performance.now()-(this.started||performance.now()))});
  }
}
