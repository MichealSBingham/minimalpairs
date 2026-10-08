import {useEffect,useState} from 'react';
import {analyticsExcluded,setAnalyticsExcluded} from '../lib/measurement';
export default function AnalyticsSettings(){
 const [excluded,setExcluded]=useState<boolean|null>(null),[error,setError]=useState(false);
 useEffect(()=>{if(new URLSearchParams(location.search).get('exclude')==='1')setError(!setAnalyticsExcluded(true));setExcluded(analyticsExcluded());},[]);
 function change(value:boolean){setError(!setAnalyticsExcluded(value));setExcluded(analyticsExcluded());}
 return <section><h2>{excluded===null?'Loading…':excluded?'This browser is excluded':'This browser is not excluded'}</h2><p>Exclude your own visits and testing from business analytics. This setting stays on this browser and applies to every tab on this site.</p><button className="button button-dark" onClick={()=>change(true)}>Exclude this browser</button>{excluded&&<button className="text-button" onClick={()=>change(false)}>Remove exclusion</button>}{error&&<p role="alert">The browser could not save the setting. Analytics remains off for this visit.</p>}<p>Repeat this on each browser or device you use. Clearing site storage removes the setting. Removing exclusion does not opt you into analytics; you must still choose to allow it.</p><p>Automated browsers and localhost are excluded automatically. Existing historical visits cannot be removed by this switch.</p><a href="/practice">Back to lessons →</a></section>;
}
