import {useState} from 'react';
import StationOnboarding from '../components/StationOnboarding';
import {request} from '../lib/auth';
export default function Onboarding({onComplete,initialStationId='',initialConsent=false}){
 const [stationId,setStationId]=useState(String(initialStationId||'')),[consent,setConsent]=useState(initialConsent),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(e){e.preventDefault();setBusy(true);setError('');try{await request('/alert-preferences',{station_id:Number(stationId),weather_enabled:false,flood_enabled:consent,replace_existing:true},'PUT');onComplete({station_id:Number(stationId),flood_enabled:consent});}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="card"><h2>Choose your monitoring location</h2><p>Choose an area to monitor. Rivora will send email notifications for relevant verified official flood warnings when available.</p><form onSubmit={save}><StationOnboarding {...{stationId,setStationId,consent,setConsent}}/>{error&&<p role="alert">{error}</p>}<button disabled={busy||!stationId}>{busy?'Saving…':'Save and open dashboard'}</button></form><button type="button" onClick={()=>onComplete(null)}>Continue without location personalization</button><p className="muted">Rivora relays verified issuances; it is not an emergency-warning authority. Missing warnings are not proof of safety. Saving replaces your existing station subscriptions. No precise location is collected unless you choose the optional location button.</p></section>;
}
