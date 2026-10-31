import { LiveSession } from './live.js';
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
let config,word='ship',phase='loading',history=[],sequence=0,capture=null,disposed=false,examplePlayer=null;
const colors=['#b17643','#28694c'];
let live=null,livePoint=null,liveTrail=[],liveReport=null,engineReady=false;

function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function sync(){const idle=phase==='idle';for(const id of ['listen','speaker','demo','upload'])$(id).disabled=!idle||!engineReady;
  $('live-toggle').disabled=!(idle||phase==='live'||phase==='live-permission');
  $('live-toggle').textContent=phase==='live-permission'?'Cancel microphone request':phase==='live'?'Pause live view':'Start live view';
  $('live-toggle').classList.toggle('stop',phase==='live'||phase==='live-permission');
  $('device').disabled=!idle;
  document.body.classList.toggle('live-active',phase==='live'||phase==='live-permission');
  document.querySelectorAll('[data-word]').forEach(b=>b.disabled=!idle);
  $('record').disabled=!(idle||phase==='recording')||!engineReady;$('record').classList.toggle('stop',phase==='recording');
  $('record').textContent=phase==='recording'?'Stop & compare':phase==='analyzing'?'Measuring…':phase==='permission'?'Allow microphone…':phase==='stopping'?'Finishing…':`Record ${word}`;
  $('clear').disabled=!idle||!history.length;$('export').disabled=!idle||!history.length;
  $('mic-orb').classList.toggle('recording',phase==='recording');
}
function selectWord(value){word=value;document.querySelectorAll('[data-word]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.word===word)));
  $('cue').textContent=`Say “${word}”.`;$('listen-word').textContent=word;sync();}
document.querySelectorAll('[data-word]').forEach(b=>b.onclick=()=>selectWord(b.dataset.word));
function reference(value=word){return config.references.find(r=>r.voice_id===$('speaker').value&&r.word===value);}
function pauseAudio(){examplePlayer?.pause();document.querySelectorAll('audio').forEach(a=>a.pause());}
$('listen').onclick=async()=>{pauseAudio();const ref=reference();examplePlayer=new Audio('/api/reference?id='+encodeURIComponent(ref.id));try{await examplePlayer.play();}catch{status('The example could not play. Try again.',true);}};

function svg(tag,attrs={},text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;}
function draw(){const map=$('map'),compact=window.innerWidth<=650,W=compact?420:650,H=compact?320:360,left=compact?54:65,right=W-20,bottom=H-65,mid=(left+right)/2;
  map.setAttribute('viewBox',`0 0 ${W} ${H}`);map.replaceChildren(svg('title',{id:'map-title'},'Vowel sound map'),svg('desc',{id:'map-desc'},'Live estimated vowel resonances and saved word measurements. These are not correctness scores.'));
  const x=f2=>left+(4500-f2)/4300*(right-left),y=f1=>30+Math.log(f1/100)/Math.log(15)*(bottom-30);
  map.append(svg('rect',{x:left,y:30,width:right-left,height:bottom-30,rx:12,fill:'#f9fbf6'}));
  for(const f2 of [1000,2000,3000,4000])map.append(svg('line',{x1:x(f2),x2:x(f2),y1:30,y2:bottom,stroke:'#e6ece0','stroke-dasharray':'3 5'}),svg('text',{x:x(f2),y:bottom+23,'text-anchor':'middle',fill:'#819075','font-size':compact?13:10},String(f2)));
  for(const f1 of [200,400,800,1200])map.append(svg('line',{x1:left,x2:right,y1:y(f1),y2:y(f1),stroke:'#e6ece0','stroke-dasharray':'3 5'}),svg('text',{x:left-10,y:y(f1)+4,'text-anchor':'end',fill:'#819075','font-size':compact?13:10},String(f1)));
  map.append(svg('text',{x:mid,y:H-12,'text-anchor':'middle',fill:'#718767','font-size':compact?14:11},'F2 resonance · higher ← → lower'),svg('text',{x:compact?13:18,y:(bottom+30)/2,transform:`rotate(-90 ${compact?13:18} ${(bottom+30)/2})`,'text-anchor':'middle',fill:'#718767','font-size':compact?14:11},'F1 resonance · higher ↓'));
  const recent=history.slice(-2);let shown=0;
  $('map-scope').textContent=recent.length&&recent.every(a=>a.kind==='example')?'Examples · not personal targets':recent.some(a=>a.kind==='example')?'Different speakers · compare with care':'Same microphone · your own voice';
  recent.forEach((attempt,i)=>{const m=attempt.result.measurement;if(!m)return;shown++;const color=colors[recent.length===1?1:i],cx=x(m.f2_hz),cy=y(m.f1_hz),other=recent[1-i]?.result.measurement;
    const labelAbove=other?m.f1_hz<other.f1_hz:i===0,labelLeft=cx>W-155;
    const group=svg('g',{'data-attempt-point':attempt.id});group.append(svg('line',{x1:x(m.f2_iqr_hz[0]),x2:x(m.f2_iqr_hz[1]),y1:cy,y2:cy,stroke:color,'stroke-width':3,opacity:.4}),svg('line',{x1:cx,x2:cx,y1:y(m.f1_iqr_hz[0]),y2:y(m.f1_iqr_hz[1]),stroke:color,'stroke-width':3,opacity:.4}),svg('circle',{cx,cy,r:8,fill:attempt.kind==='example'?'#fff':color,stroke:color,'stroke-width':2}),svg('text',{x:cx+(labelLeft?-14:14),y:cy+(labelAbove?-16:24),'text-anchor':labelLeft?'end':'start',fill:color,'font-size':compact?16:13,'font-weight':600},`${attempt.kind==='example'?'Example':attempt.id} · ${attempt.word}`));map.append(group);});
  if(!shown&&!livePoint)map.append(svg('text',{x:mid,y:140,'text-anchor':'middle',fill:'#607d5f','font-size':compact?21:19},phase==='live'?'Listening for a vowel…':recent.length?'No saved point this time':'See your sound move.'),svg('text',{x:mid,y:168,'text-anchor':'middle',fill:'#7e9375','font-size':compact?14:12},phase==='live'?'Hold “ih” or “ee” for a moment.':'Press Start live view. No quiet countdown.'));
  else if(recent.length&&recent.at(-1)?.result.status!=='measured')map.append(svg('text',{x:mid,y:bottom-13,'text-anchor':'middle',fill:'#9a774c','font-size':compact?13:11},'No point for the latest attempt.'));
  if(livePoint){
    for(const [i,p] of liveTrail.entries())map.append(svg('circle',{cx:x(p.f2),cy:y(p.f1),r:3,fill:'#227ca2',opacity:.12+.35*i/Math.max(1,liveTrail.length)}));
    map.append(svg('circle',{'data-live-point':'true',cx:x(livePoint.f2),cy:y(livePoint.f1),r:10,fill:'#227ca2',stroke:'#fff','stroke-width':3}),svg('text',{x:mid,y:18,'text-anchor':'middle',fill:'#227ca2','font-size':compact?14:12},'LIVE · approximate, not a grade'));
  }
}
window.addEventListener('resize',draw);
function renderFeedback(attempt){const box=$('feedback');box.replaceChildren();box.classList.toggle('uncertain',attempt.result.status!=='measured');
  const r=attempt.result;box.append(el('p','eyebrow',attempt.kind==='example'?'EXAMPLE AUDIO · ANOTHER SPEAKER':r.status==='measured'?'YOUR CENTRAL VOWEL SOUND':'NO POINT FOR THIS ATTEMPT'),el('h3','',r.title),el('p','',attempt.kind==='example'&&r.status==='measured'?'This is an example speaker’s sound, not a personal target. Record your own attempts to compare your voice.':r.tip));}
function renderHistory(){const container=$('attempts');container.replaceChildren();$('empty-history').hidden=history.length>0;$('count').textContent=history.length?`${history.length} recording${history.length===1?'':'s'}`:'No attempts yet';
  for(const a of [...history].reverse()){const card=el('article','attempt'),top=el('div','attempt-top');top.append(el('h3','',`${a.id} · ${a.word}`),el('span','tag'+(a.result.status==='measured'?'':' uncertain'),a.result.status==='measured'?'Measured':'No point'));card.append(top,el('p','kind',a.kind==='example'?`Example · ${a.speaker}`:`Your ${a.kind==='microphone'?'microphone recording':'uploaded recording'} · Prompt: ${a.word}`));
    const audio=el('audio');audio.controls=true;audio.preload='metadata';audio.src=a.url;audio.setAttribute('aria-label',`Replay ${a.kind==='example'?'example ':''}${a.word} recording ${a.id}`);audio.addEventListener('play',()=>{examplePlayer?.pause();document.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause();});});card.append(audio);
    const row=el('div','small-row');row.append(el('span','',a.kind==='microphone'?'Background check included':'No guided background check'));
    if(a.blob){const save=el('a','', 'Save audio');save.href=a.url;save.download=`minimalpairs-${a.id}-${a.word}.wav`;row.append(save);}card.append(row);
    const detail=el('details'),summary=el('summary','','Measurement details');detail.append(summary);
    if(a.result.measurement){const m=a.result.measurement;detail.append(el('p','',`F1 ${m.f1_hz} Hz · F2 ${m.f2_hz} Hz. ${a.result.accepted_frames}/${a.result.sampled_frames} central samples agreed. Whiskers show variation among those samples, not a confidence interval.`));}
    else detail.append(el('p','',a.result.title+' '+a.result.tip));
    detail.append(el('p','',a.result.analysis_ms===null?'Measurement did not finish. The audio is available to replay.':`${(a.result.analysis_ms/1000).toFixed(2)} s to measure. Pronunciation and word identity are not graded.`));card.append(detail);container.append(card);
  }draw();sync();}
function addAttempt(data){const a={id:++sequence,created_at:new Date().toISOString(),...data};history.push(a);if(history.length>8){const old=history.shift();if(old.blob)URL.revokeObjectURL(old.url);}renderHistory();renderFeedback(a);}
async function request(url,body){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);try{const response=await fetch(url,{method:'POST',body,headers:body?{'Content-Type':'audio/wav'}:{},signal:controller.signal});let result;try{result=await response.json();}catch{throw Error('The local engine returned an unreadable response.');}if(!response.ok)throw Error(result.error||'The measurement could not finish.');return result;}catch(e){if(e.name==='AbortError')throw Error('The measurement timed out. Try a shorter recording.');throw e;}finally{clearTimeout(timeout);}}
async function measure(blob,kind,prompt,metadata={}){phase='analyzing';sync();status('Measuring the central sound on this Mac…');try{const result=await request('/api/measure?lead_in_ms='+(kind==='microphone'?600:0),blob);if(disposed)return;addAttempt({word:prompt,kind,result,metadata,blob,url:URL.createObjectURL(blob)});status(result.status==='measured'?'Ready. Replay your word, then record another attempt.':result.title,result.status!=='measured');}catch(e){if(!disposed)addAttempt({word:prompt,kind,metadata,blob,url:URL.createObjectURL(blob),result:{status:'error',reason:'analysis_failure',grade:null,measurement:null,analysis_ms:null,title:'The measurement could not finish.',tip:'Your recording is still here. Listen back, save the audio, or try again.'}});status(e.message,true);}finally{phase='idle';$('level-fill').style.width='0%';$('timer').textContent='A brief quiet check comes first';$('cue').textContent=`Say “${word}”.`;sync();}}
function wav(samples,sr){const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer);const text=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};text(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);samples.forEach((s,i)=>v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,s))*32767),true));return new Blob([buffer],{type:'audio/wav'});}
async function release(c){clearTimeout(c?.timeout);clearTimeout(c?.resumeTimeout);c?.stream?.getTracks().forEach(t=>t.stop());try{c?.source?.disconnect();c?.node?.disconnect();if(c?.ctx&&c.ctx.state!=='closed')await c.ctx.close();}catch{}}
async function stop(){if(phase!=='recording'||!capture)return;phase='stopping';sync();const c=capture;clearTimeout(c.timeout);c.source.disconnect();c.stream.getTracks().forEach(t=>t.stop());
  try{await new Promise((resolve,reject)=>{c.finish=resolve;c.finishTimeout=setTimeout(()=>reject(Error('The microphone could not finish. Please try again.')),1500);c.node.port.postMessage('finish');});
    const samples=new Float32Array(c.chunks.reduce((n,a)=>n+a.length,0));let offset=0;for(const chunk of c.chunks){samples.set(chunk,offset);offset+=chunk.length;}await release(c);capture=null;if(!disposed)await measure(wav(samples,c.rate),'microphone',c.prompt,c.metadata);
  }catch(e){await release(c);capture=null;phase='idle';status(e.message,true);sync();}finally{clearTimeout(c.finishTimeout);}}
$('record').onclick=async()=>{if(phase==='recording')return stop();if(phase!=='idle')return;pauseAudio();phase='permission';sync();status('Allow the microphone, then wait for Speak now. For continuous feedback, use Start live view.');const c={chunks:[],count:0,prompt:word};capture=c;
  try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone access needs this page to be opened on localhost in a supported browser.');
    c.ctx=new AudioContext();const resumed=c.ctx.resume();resumed.catch(()=>{});
    c.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false,...($('device').value?{deviceId:{exact:$('device').value}}:{})},video:false});if(disposed){await release(c);return;}
    const settings=c.stream.getAudioTracks()[0].getSettings();showDevice(c.stream.getAudioTracks()[0].label,settings);c.metadata={device_label:c.stream.getAudioTracks()[0].label,echo_cancellation:settings.echoCancellation??null,noise_suppression:settings.noiseSuppression??null,auto_gain:settings.autoGainControl??null};
    c.rate=c.ctx.sampleRate;await c.ctx.audioWorklet.addModule('/capture.js');await Promise.race([resumed,new Promise((_,reject)=>{c.resumeTimeout=setTimeout(()=>reject(Error('Audio did not start. Please try again.')),4000);})]);clearTimeout(c.resumeTimeout);c.source=c.ctx.createMediaStreamSource(c.stream);c.node=new AudioWorkletNode(c.ctx,'word-capture');
    c.node.port.onmessage=e=>{if(e.data.samples){const samples=e.data.samples;c.chunks.push(samples);c.count+=samples.length;if(phase==='recording'){const seconds=c.count/c.rate;const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);$('level-fill').style.width=Math.min(100,Math.sqrt(rms)*250)+'%';$('timer').textContent=seconds<.6?'Checking the background…':`${(seconds-.6).toFixed(1)} s · stops after 4 seconds`;$('cue').textContent=seconds<.6?'A moment of quiet…':`Speak now: “${c.prompt}”.`;if(seconds>=4.6)void stop();}}
      if(e.data.finished){clearTimeout(c.finishTimeout);c.finish?.();}};
    const silent=c.ctx.createGain();silent.gain.value=0;c.source.connect(c.node);c.node.connect(silent).connect(c.ctx.destination);phase='recording';sync();$('cue').textContent='A moment of quiet…';status('Stay quiet until “Speak now”, then say one word and press Stop.');c.timeout=setTimeout(()=>void stop(),6000);
  }catch(e){await release(c);capture=null;phase='idle';status(e.name==='NotAllowedError'?'Microphone access was not allowed. Enable it in your browser, or choose a recording.':e.message,true);sync();}};
$('upload').onchange=async e=>{const file=e.target.files[0];if(!file)return;pauseAudio();phase='analyzing';sync();status('Reading your recording…');const prompt=word;let ac;
  try{if(file.size>2500000)throw Error('Choose a recording smaller than 2.5 MB.');ac=new AudioContext();const audio=await ac.decodeAudioData(await file.arrayBuffer());if(audio.duration>6)throw Error('Choose one word in a recording of six seconds or less.');const mono=new Float32Array(audio.length);for(let c=0;c<audio.numberOfChannels;c++){const channel=audio.getChannelData(c);for(let i=0;i<mono.length;i++)mono[i]+=channel[i]/audio.numberOfChannels;}await measure(wav(mono,audio.sampleRate),'upload',prompt,{filename:file.name});}
  catch(e){status(e.message,true);}finally{if(ac&&ac.state!=='closed')await ac.close();$('upload').value='';phase='idle';sync();}};
$('demo').onclick=async()=>{pauseAudio();phase='analyzing';sync();status('Measuring two example recordings…');try{for(const w of ['ship','sheep']){const ref=reference(w);const result=await request('/api/example?id='+encodeURIComponent(ref.id));if(disposed)return;addAttempt({word:w,kind:'example',speaker:ref.speaker,url:'/api/reference?id='+encodeURIComponent(ref.id),result,reference_id:ref.id});}status('Example audio is ready. These are another speaker’s measurements.');}catch(e){status(e.message,true);}finally{phase='idle';sync();}};
$('clear').onclick=()=>{pauseAudio();for(const a of history)if(a.blob)URL.revokeObjectURL(a.url);history=[];renderHistory();$('feedback').classList.remove('uncertain');$('feedback').replaceChildren(el('p','eyebrow','A FRESH START'),el('h3','','Ready for your next word.'),el('p','','Record two attempts and listen to the difference.'));status('Session cleared. Your recordings have been removed from this tab.');};
function download(blob,name){const url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=()=>{const data={schema_version:1,exported_at:new Date().toISOString(),notice:'Experimental measurements, not correctness labels. Prompt words are user selections. Audio is not included; save it separately.',attempts:history.map(({blob,url,...a})=>a)};download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'minimalpairs-speaking-session.json');status('Measurements exported. Use “Save audio” on each recording to keep its sound too.');};
window.addEventListener('pagehide',()=>{disposed=true;void live?.stop();void release(capture);pauseAudio();for(const a of history)if(a.blob)URL.revokeObjectURL(a.url);});
async function showDevice(label,settings){
  $('device-info').textContent=`${label||'Microphone'} · ${settings.sampleRate||'unknown'} Hz${settings.noiseSuppression?' · noise reduction on':''}${settings.echoCancellation?' · echo cancellation on':''}`;
  try {const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
    $('device').replaceChildren(new Option('System default',''));for(const d of devices)$('device').add(new Option(d.label||'Microphone',d.deviceId));
    if(settings.deviceId)$('device').value=settings.deviceId;
  }catch{}
}
$('live-toggle').onclick=()=>{
  if(live){void live.stop();return;}if(phase!=='idle')return;
  pauseAudio();phase='live-permission';liveReport=null;sync();
  $('live-status').textContent='Allow your microphone. You can cancel here.';
  const session=new LiveSession({
    onPoint:p=>{livePoint=p;if(p){liveTrail.push(p);liveTrail=liveTrail.filter(q=>p.at-q.at<500).slice(-12);}else liveTrail=[];draw();},
    onLevel:(rms,clip)=>{$('live-level').style.width=Math.min(100,Math.sqrt(rms)*250)+'%';$('input-status').textContent=clip>.01?'Too loud — move back':rms<.003?'Input is quiet':'Microphone is receiving sound';},
    onStatus:text=>{$('live-status').textContent=text;},
    onDevice:(label,settings)=>{phase='live';showDevice(label,settings);sync();},
    onEnd:report=>{liveReport=report;live=null;$('input-status').textContent='Microphone is off';if(!disposed){phase='idle';sync();draw();}}
  });live=session;void session.start($('device').value);
};
$('diagnostics').onclick=()=>download(new Blob([JSON.stringify({notice:'Local diagnostics only. No audio or correctness labels.',device:$('device-info').textContent,live:liveReport,word_attempts:history.map(a=>({result:a.result,metadata:a.metadata}))},null,2)],{type:'application/json'}),'minimalpairs-diagnostics.json');
// Background tabs must not keep a microphone running invisibly.
document.addEventListener('visibilitychange',()=>{if(document.hidden&&live)void live.stop('Live practice paused while the page was in the background.');});
window.addEventListener('pageshow',e=>{if(e.persisted){disposed=false;phase='idle';history=[];capture=null;live=null;renderHistory();}});
draw();
try{const response=await fetch('/api/config');if(!response.ok)throw Error();config=await response.json();const voices=new Map(config.references.map(r=>[r.voice_id,r.speaker]));for(const [id,name] of voices)$('speaker').add(new Option(name,id));if(voices.has('human-en-grendelkhan'))$('speaker').value='human-en-grendelkhan';
  const credits=$('credits');credits.append(el('p','','Human examples from Wikimedia Commons / Lingua Libre. Source labels and provenance are available; independent phonetic listening review is pending. They are examples, not validated personal targets.'));
  for(const r of config.references){const div=el('div','credit');div.append(el('strong','',`${r.word} · ${r.speaker}`));const p=el('p');const source=el('a','','Original source');source.href=r.source;source.target='_blank';source.rel='noreferrer';const license=el('a','',r.license.id);license.href=r.license.url;license.target='_blank';license.rel='noreferrer';p.append(source,document.createTextNode(' · '),license);div.append(p,el('p','',r.changes));credits.append(div);}engineReady=true;phase='idle';selectWord('ship');status('Ready. Listen to an example, then try it with your voice.');}
catch{phase='idle';sync();status('Word comparison is unavailable. Live view still works in this browser. Restart the local server and reload to compare recordings.',true);}
