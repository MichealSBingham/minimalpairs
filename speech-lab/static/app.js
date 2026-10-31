const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cfg=await fetch('/api/config').then(r=>r.json());
let pair='tout-tu',target=0,busy=false,recording=false,stream,ctx,node,source,timer;
let chunks=[],points=[],pinned=[],replayUrl,workerBusy=false,liveFrame=new Float32Array(0);
const worker=new Worker('/analysis-worker.js',{type:'module'});
worker.onmessage=e=>{workerBusy=false;if(recording&&e.data.ok){points.push(e.data);points=points.slice(-90);draw();}};
const canvas=$('map'),g=canvas.getContext('2d');
function xy(f1,f2){return [75+Math.log(3500/f2)/Math.log(3500/500)*750,45+Math.log(f1/150)/Math.log(1200/150)*440];}
function draw(){
  const w=900,h=580;g.clearRect(0,0,w,h);g.fillStyle='#fafbf6';g.fillRect(64,30,785,470);
  g.font='14px system-ui';g.textAlign='center';g.lineWidth=1;
  for(const f2 of [500,1000,1500,2000,3000]){const [x]=xy(150,f2);g.strokeStyle='#e1e6dc';g.beginPath();g.moveTo(x,30);g.lineTo(x,500);g.stroke();g.fillStyle='#83918a';g.fillText(f2,x,525);}
  for(const f1 of [200,400,600,800,1000]){const [,y]=xy(f1,500);g.strokeStyle='#e1e6dc';g.beginPath();g.moveTo(64,y);g.lineTo(849,y);g.stroke();g.textAlign='right';g.fillStyle='#83918a';g.fillText(f1,54,y+5);}
  g.textAlign='center';g.fillStyle='#809087';g.font='13px system-ui';g.fillText('F2 (Hz) · higher ← → lower',450,559);g.save();g.translate(15,265);g.rotate(-Math.PI/2);g.fillText('F1 (Hz) · higher ↓',0,0);g.restore();
  const marks=[['i',280,2400],['y',290,1750],['u',300,750],['ɪ',420,2050],['ɛ',620,1800],['a',850,1400],['ɔ',550,850]];
  for(const [label,f1,f2] of marks){const [x,y]=xy(f1,f2);g.fillStyle='#d1dacc';g.font='32px Georgia';g.fillText(label,x,y);}
  function trace(rows,color){g.strokeStyle=color;g.lineWidth=2;g.beginPath();rows.forEach((r,i)=>{const [x,y]=xy(r.f1,r.f2);if(i)g.lineTo(x,y);else g.moveTo(x,y);});g.stroke();for(const r of rows){const [x,y]=xy(r.f1,r.f2);g.beginPath();g.fillStyle=color;g.arc(x,y,3.5,0,2*Math.PI);g.fill();}}
  trace(pinned,'#a5b0a37a');trace(points,'#137c7080');
  if(points.length){const p=points.at(-1),[x,y]=xy(p.f1,p.f2);g.beginPath();g.fillStyle='#137c70';g.arc(x,y,8,0,2*Math.PI);g.fill();g.strokeStyle='white';g.lineWidth=3;g.stroke();}
  else{g.fillStyle='#73867b';g.font='15px system-ui';g.fillText('Your acoustic trace will appear here',450,420);}
}
function currentRef(){return cfg.references.find(r=>r.id===$('reference').value);}
function credits(){const r=currentRef();if(!r)return;$('credit').innerHTML=`${esc(r.speaker)} · ${esc(r.license.id)} · <a href="${esc(r.source)}" target="_blank" rel="noreferrer">Source</a><br>Source-labeled recording; phonetic review pending.`;}
function refresh(){
  const p=cfg.pairs[pair];$('tip').textContent=p.tip;
  $('targets').innerHTML=p.words.map((word,i)=>`<button class="target ${target===i?'active':''}" data-target="${i}" aria-pressed="${target===i}">${esc(word)}<small>/${esc(p.phones[i].join(''))}/</small></button>`).join('');
  document.querySelectorAll('[data-target]').forEach(b=>b.onclick=()=>{if(busy||recording)return;target=Number(b.dataset.target);refresh();});
  $('reference').innerHTML=cfg.references.filter(r=>r.pair===pair).map(r=>`<option value="${esc(r.id)}">${esc(r.word)} · ${esc(r.speaker)}</option>`).join('');
  const desired=cfg.references.find(r=>r.pair===pair&&r.word===p.words[target]);if(desired)$('reference').value=desired.id;
  credits();
}
for(const [id,p] of Object.entries(cfg.pairs))$('pair').add(new Option(`${p.language} · ${p.words.join(' / ')}`,id));
$('pair').onchange=()=>{pair=$('pair').value;target=0;points=[];pinned=[];$('pin').disabled=true;refresh();draw();};
$('reference').onchange=credits;
$('listen').onclick=()=>new Audio('/api/reference?id='+encodeURIComponent($('reference').value)).play().catch(e=>{$('status').textContent=e.message;});
function setBusy(on){busy=on;for(const id of ['demo','pair','reference','listen','upload','record'])$(id).disabled=on;document.querySelectorAll('[data-target]').forEach(b=>b.disabled=on);}
function render(r){
  points=r.formants||[];draw();$('pin').disabled=!points.length;
  const labels={'target-evidence':'TARGET PATTERN DETECTED','contrast-evidence':'OTHER PATTERN DETECTED',uncertain:'NO RELIABLE DECISION',retry:'TRY ANOTHER RECORDING'};
  $('result').innerHTML=`<span class="label">${labels[r.status]||'EXPERIMENTAL RESULT'}</span><h3>${esc(r.message)}</h3>${r.phones?.length?`<div class="phones">[${esc(r.phones.join(' '))}]</div><p>Model hypothesis, not a verified IPA transcription. Target: /${esc(r.target_ipa)}/.</p>`:''}<p>${esc(r.tip||'')}</p><p class="small">${r.latency_s.toFixed(2)} seconds to analyze · ${points.length} accepted acoustic frames · No accent or correctness grade.</p>`;
  $('status').textContent='Analysis complete. Listen back, then try again or switch words.';
}
async function analyze(url,body){setBusy(true);$('status').textContent='Comparing the sound patterns locally…';try{const res=await fetch(url,{method:'POST',body,headers:body?{'Content-Type':'audio/wav'}:{}});const r=await res.json();if(!res.ok)throw Error(r.error||'Analysis failed');render(r);}catch(e){$('status').textContent=e.message;}finally{setBusy(false);}}
$('demo').onclick=()=>{const id=$('reference').value;$('replay').src='/api/reference?id='+encodeURIComponent(id);$('replay').hidden=false;analyze(`/api/demo?id=${encodeURIComponent(id)}&pair=${pair}&target=${target}`);};
$('pin').onclick=()=>{pinned=points.map(p=>({...p}));draw();$('status').textContent='Trace pinned. Record another attempt to compare. Different speakers can naturally occupy different regions.';};
function wav(samples,sr){const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer);const text=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};text(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);samples.forEach((s,i)=>v.setInt16(44+i*2,Math.max(-1,Math.min(1,s))*32767,true));return new Blob([buffer],{type:'audio/wav'});}
function replay(blob){if(replayUrl)URL.revokeObjectURL(replayUrl);replayUrl=URL.createObjectURL(blob);$('replay').src=replayUrl;$('replay').hidden=false;}
async function stop(){if(!recording)return;recording=false;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());source?.disconnect();node?.disconnect();const sr=ctx.sampleRate;await ctx.close();$('record').textContent='● Record a word';const total=chunks.reduce((n,c)=>n+c.length,0),samples=new Float32Array(total);let pos=0;for(const c of chunks){samples.set(c,pos);pos+=c.length;}chunks=[];const blob=wav(samples,sr);replay(blob);await analyze(`/api/analyze?pair=${pair}&target=${target}`,blob);}
$('record').onclick=async()=>{if(recording)return stop();if(busy)return;try{
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
  ctx=new AudioContext();await ctx.audioWorklet.addModule('/record-worklet.js');await ctx.resume();source=ctx.createMediaStreamSource(stream);node=new AudioWorkletNode(ctx,'sound-recorder');
  chunks=[];points=[];liveFrame=new Float32Array(0);recording=true;setBusy(true);busy=false;$('record').disabled=false;$('record').textContent='■ Stop & compare';$('status').textContent='Listening… say one word. The map is exploratory; finish to compare sound patterns.';
  node.port.onmessage=e=>{if(!recording)return;const a=e.data;chunks.push(a);const n=Math.round(ctx.sampleRate*.05);let merged=new Float32Array(liveFrame.length+a.length);merged.set(liveFrame);merged.set(a,liveFrame.length);liveFrame=merged.slice(-n);if(liveFrame.length===n&&!workerBusy){workerBusy=true;worker.postMessage({samples:liveFrame,sampleRate:ctx.sampleRate});}};
  source.connect(node);const silent=ctx.createGain();silent.gain.value=0;node.connect(silent).connect(ctx.destination);timer=setTimeout(stop,12000);
}catch(e){recording=false;stream?.getTracks().forEach(t=>t.stop());if(ctx&&ctx.state!=='closed')await ctx.close();setBusy(false);$('record').textContent='● Record a word';$('status').textContent='Microphone unavailable: '+e.message;}};
$('upload').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>5000000)throw Error('Choose an audio file under 5 MB.');const ac=new AudioContext();let buffer;try{buffer=await ac.decodeAudioData(await f.arrayBuffer());}finally{await ac.close();}if(buffer.duration>15)throw Error('Choose a recording of 15 seconds or less.');const a=new Float32Array(buffer.length);for(let c=0;c<buffer.numberOfChannels;c++){const channel=buffer.getChannelData(c);for(let i=0;i<a.length;i++)a[i]+=channel[i]/buffer.numberOfChannels;}const blob=wav(a,buffer.sampleRate);replay(blob);await analyze(`/api/analyze?pair=${pair}&target=${target}`,blob);}catch(e){$('status').textContent=e.message;}finally{$('upload').value='';}};
document.querySelectorAll('[data-panel]').forEach(button=>button.onclick=()=>{document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!==button.dataset.panel);document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b===button));});
try{const r=await fetch('/api/results').then(r=>r.json());if(r.contrast){$('metrics').innerHTML=[['24','Public human word recordings'],[`${r.contrast.clean.gated_n}/24`,'Word recordings with a gated decision'],[`${r.learner.n}`,'Expert-rated learner sentences']].map(([n,label])=>`<div class="metric"><b>${esc(n)}</b><span>${esc(label)}</span></div>`).join('');$('findings').innerHTML=`<p><b>Word pairs:</b> raw two-choice ranking matched source labels on ${r.contrast.clean.ranking_correct}/24 recordings. The stricter gate answered ${r.contrast.clean.gated_n}/24; ${r.contrast.clean.gated_wrong} accepted decisions disagreed with the source label.</p><p><b>Important limit:</b> zero observed errors in a tiny accepted sample does not establish a low error rate. Abstentions count against coverage.</p><p><b>Learner speech:</b> a naive phoneme-mismatch baseline falsely flagged ${(r.learner.phone_false_correction_rate*100).toFixed(1)}% of the evaluated acceptable phonemes. That is why this prototype does not turn transcript differences into pronunciation grades.</p><p><b>Controls:</b> ${r.controls.withheld}/${r.controls.n} silence, noise, tone, clipping and wrong-exercise controls received no confident judgment.</p>`;}}catch{}
refresh();draw();
window.addEventListener('pagehide',()=>{stream?.getTracks().forEach(t=>t.stop());worker.terminate();if(replayUrl)URL.revokeObjectURL(replayUrl);});
