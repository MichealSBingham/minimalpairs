import {useEffect,useRef,useState} from 'react';
import Trainer from './Trainer';
import {observeSession} from '../lib/auth';
import {getEntitlement} from '../lib/entitlements';
import type {Language} from '../lib/types';

type Access='checking'|'free'|'paid'|'lifetime'|'error';
export default function PracticeLibrary({languages}:{languages:Language[]}){
 const [access,setAccess]=useState<Access>('checking');const [uid,setUid]=useState('');const [revision,setRevision]=useState(0);
 const epoch=useRef(0);
 useEffect(()=>{const unsubscribe=observeSession(async session=>{const generation=++epoch.current;setUid(session?.user.id||'');setAccess('checking');if(!session?.user.email_verified){setAccess('free');return;}try{const grant=await getEntitlement({expectedUserId:session.user.id,fresh:true});if(generation===epoch.current)setAccess(grant?.active?(grant.plan==='lifetime'?'lifetime':'paid'):'free');}catch{if(generation===epoch.current)setAccess('error');}});return()=>{++epoch.current;unsubscribe();};},[revision]);
 return <Trainer key={`${uid}:${access}`} languages={languages} signedIn={Boolean(uid)} exerciseAccess={access} onRetryAccess={()=>setRevision(r=>r+1)}/>;
}
