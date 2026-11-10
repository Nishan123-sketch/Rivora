import {useEffect,useRef,useState} from 'react';
import {request} from '../lib/auth';
import {apiFetch} from '../lib/apiFetch';
import {nearestRegistrationStation,registrationPosition} from '../lib/registrationLocation';
import '../styles/auth.css';

export default function Register({onLogin}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[otp,setOtp]=useState(''),[stage,setStage]=useState('register');
 const [stations,setStations]=useState([]),[province,setProvince]=useState(''),[detected,setDetected]=useState(null),[location,setLocation]=useState(null);
 const [locating,setLocating]=useState(false),[locationError,setLocationError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{const c=new AbortController();apiFetch('/api/monitoring-locations',{signal:AbortSignal.any([c.signal,AbortSignal.timeout(10000)])}).then(r=>{if(!r.ok)throw Error('The station catalog is unavailable. Click Enable Location to retry.');return r.json();}).then(d=>{if(!c.signal.aborted)setStations(d.data||[]);}).catch(e=>{if(!c.signal.aborted)setLocationError(e.message);});return()=>c.abort();},[]);
 async function enableLocation(){
  setLocating(true);setLocationError('');setDetected(null);setLocation(null);
  try{
   // One permission request per click; no background tracking.
   const position=await registrationPosition(navigator.geolocation);
   let catalog=stations;
   if(!catalog.length){const r=await apiFetch('/api/monitoring-locations',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('The station catalog is unavailable. Please retry.');catalog=(await r.json()).data||[];}
   const station=nearestRegistrationStation(position,catalog);
   if(!mounted.current)return;
   setStations(catalog);setDetected(station);setProvince(station.province);
   setLocation({latitude:position.coords.latitude,longitude:position.coords.longitude,captured_at:position.timestamp});
  }catch(e){if(mounted.current)setLocationError(e.message);}finally{if(mounted.current)setLocating(false);}
 }
 async function action(kind){
  if(kind==='register'&&(!location||!detected||!province)){setLocationError('Enable Location to detect an eligible monitoring station before registering.');return;}
  setBusy(true);setMessage('');
  try{const d=await request('/auth/'+kind,kind==='verify-otp'?{email,otp}:kind==='register'?{email,password,station_id:Number(detected.station_id),province,location,email_consent:false}:{email,password});setMessage(d.message);if(kind==='register'){setStage('verify');setLocation(null);}if(kind==='verify-otp')setStage('done');}
  catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 const provinces=[...new Set(stations.map(s=>s.province))].sort();
 return <div className="auth-page login-page registration-page">
  <section className="auth-hero login-hero"><div className="auth-logo"><span className="auth-wave">≋</span><div><strong>Rivora</strong><small>WATER • WEATHER • RISK</small></div></div><div className="auth-hero-copy"><span className="login-eyebrow">YOUR MONITORING SPACE STARTS HERE</span><h1>Monitor what<br/>matters to you.</h1><p>Connect your account to a sourced monitoring station.</p></div><div className="auth-hero-foot">Monitoring information · Not an emergency-warning authority</div></section>
  <section className="auth-panel"><div className="auth-form login-card"><h2>{stage==='register'?'Create your account':stage==='verify'?'Verify your email':'Email verified'}</h2><p>{stage==='register'?'Choose your monitoring area and enable location to get started.':'Complete email verification before signing in.'}</p>
   <form onSubmit={e=>{e.preventDefault();action(stage==='register'?'register':'verify-otp');}}>
    <div className="registration-fields">
    <label>Email address<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required readOnly={stage!=='register'}/></label>
    {stage==='register'&&<>
     <label>Password<input type="password" autoComplete="new-password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required/><small>At least 12 characters; at most 72 UTF-8 bytes.</small></label>
     <label>Province or city<select required value={province} onChange={e=>{setProvince(e.target.value);setDetected(null);setLocation(null);}}><option value="">Choose a documented monitoring area</option>{provinces.map(p=><option key={p}>{p}</option>)}</select></label>
     <div className="registration-location"><div><strong>Enable Location to continue</strong><p>Your permission is required for registration. Location is requested only when you click; precise coordinates are not saved to your account.</p></div><button type="button" className="enable-location" onClick={enableLocation} disabled={locating||busy}>{locating?'Detecting location…':locationError?'Retry':detected?'Update location':'Enable Location'}</button></div>
     {locationError&&<p role="alert" className="registration-error">{locationError}</p>}
     {detected&&<section className="registration-detected" aria-label="Detected monitoring station" role="status"><strong>{detected.station_name}</strong><p>{detected.river_name} · code {detected.station_code}</p><p>Gauge area: {detected.province} · {detected.district}</p><p>Approximate distance: {detected.distance_km.toFixed(1)} km</p><small>This is the gauge’s documented area, not a verified location boundary for your device.</small></section>}
     <p className="registration-disclaimer">The geographically nearest gauge may not represent your flood exposure or official warning area. Selecting a province does not verify warning coverage. Email alerts are off initially; you can separately opt in after email verification.</p>
    </>}
    {stage==='verify'&&<label>Verification code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value)} required/></label>}
    </div>
    {stage!=='done'&&<button type="submit" className="auth-submit" disabled={busy||locating||(stage==='register'&&(!detected||!location||!province))}>{busy?'Please wait…':stage==='register'?'Create account':'Verify email'}</button>}
    {stage==='verify'&&<button type="button" disabled={busy} onClick={()=>action('resend-otp')}>Resend code</button>}
    {message&&<p className="auth-note" role="status">{message}</p>}
   </form><div className="auth-switch">Already registered? <button onClick={onLogin}>Sign in</button></div>
  </div></section>
 </div>;
}
