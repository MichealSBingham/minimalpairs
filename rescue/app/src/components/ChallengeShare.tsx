import {useState} from 'react';
import {localPath} from '../lib/locales';
import {trackMeasurement} from '../lib/measurement';
const words: Record<string,string[]> = {
 en:['Challenge a friend','Link copied','Copy this link'],fr:['Défier un ami','Lien copié','Copiez ce lien'],es:['Reta a un amigo','Enlace copiado','Copia este enlace'],pt:['Desafie um amigo','Link copiado','Copie este link'],de:['Fordere jemanden heraus','Link kopiert','Diesen Link kopieren'],it:['Sfida un amico','Link copiato','Copia questo link'],ru:['Бросить вызов другу','Ссылка скопирована','Скопируйте ссылку'],ja:['友達に挑戦してもらう','リンクをコピーしました','このリンクをコピー'],zh:['邀请朋友挑战','链接已复制','复制此链接'],
};
export default function ChallengeShare({languageId,locale='en',path}:{languageId:string;locale?:string;path?:string}){
 const [state,setState]=useState('');const text=words[locale]||words.en;
 const url=new URL(path||localPath(locale,`/diagnostic/${languageId}`),'https://minimalpairs.co');
 url.search=new URLSearchParams({utm_source:'friend',utm_medium:'referral',utm_campaign:'listening-challenge'}).toString();
 async function share(){
  try{
   if(navigator.share)await navigator.share({title:'MinimalPairs',url:url.toString()});
   else {await navigator.clipboard.writeText(url.toString());setState('copied');}
   trackMeasurement('challenge_share',{language_id:languageId,surface:path?'guide':'diagnostic',ui_locale:locale});
  }catch(error){if((error as Error)?.name!=='AbortError')setState('manual');}
 }
 return <div className="challenge-share"><button className="text-button" onClick={()=>void share()}>{state==='copied'?text[1]:text[0]} <span aria-hidden="true">↗</span></button>{state==='manual'&&<label>{text[2]}<input readOnly value={url.toString()} onFocus={e=>e.currentTarget.select()}/></label>}<span role="status" className="diagnostic-report-sr">{state==='copied'?text[1]:''}</span></div>;
}
