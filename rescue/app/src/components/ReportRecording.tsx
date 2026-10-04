import {useEffect,useState} from 'react';
import type {PlayedRecording} from '../lib/audio';
const endpoint='https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/report';
export default function ReportRecording({clip,label='Report audio'}:{clip?:PlayedRecording;label?:string}){
 const [open,setOpen]=useState(false),[status,setStatus]=useState('');
 useEffect(()=>{setOpen(false);setStatus('');},[clip?.id,clip?.sha256]);
 if(!clip?.id||!clip.sha256)return null;
 async function report(reason:string){
  if(!clip?.id||!clip.sha256||status==='Sending…')return;
  setStatus('Sending…');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({clipId:clip.id,sha256:clip.sha256,languageId:clip.languageId,voiceId:clip.voiceId,reason})});if(!response.ok)throw Error();const data=await response.json();if(!data.saved)throw Error();setStatus('Reported. Thank you.');setOpen(false);}catch{setStatus('Could not send. Please retry.');}finally{clearTimeout(timer);}
 }
 return <span className="recording-report">{status==='Reported. Thank you.'?<small role="status">{status}</small>:<><button type="button" className="report-recording-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}>{label}</button>{open&&<span className="report-recording-options"><span>What sounds wrong?</span>{[['pronunciation','Wrong sound'],['repetition','Repeated word'],['noise','Noise or distortion']].map(([reason,text])=><button key={reason} type="button" disabled={status==='Sending…'} onClick={()=>void report(reason)}>{text}</button>)}<button type="button" onClick={()=>setOpen(false)}>Cancel</button></span>}{status&&<small role="status">{status}</small>}</>}</span>;
}
