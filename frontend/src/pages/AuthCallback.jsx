import {useEffect,useRef,useState} from 'react';
import {request,monitoringDestination} from '../lib/auth';
export default function AuthCallback({onComplete,onLogin}){
 const started=useRef(false),[error,setError]=useState('');
 useEffect(()=>{if(started.current)return;started.current=true;const code=new URLSearchParams(window.location.hash.slice(1)).get('code');window.history.replaceState({},'',window.location.pathname);request('/auth/oidc/exchange',{code}).then(()=>{sessionStorage.removeItem('weather_flood_token');return request('/alert-preferences',undefined,'GET').then(p=>onComplete(monitoringDestination(p.data).preference));}).catch(e=>setError(e.message));},[onComplete]);
 return <section className="card"><h2>Completing sign-in</h2>{error?<><p role="alert">{error}</p><button onClick={onLogin}>Return to sign-in</button></>:<p role="status">Verifying your sign-in…</p>}</section>;
}
