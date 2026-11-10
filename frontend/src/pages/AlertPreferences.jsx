import {useEffect,useState} from 'react';
import Onboarding from './Onboarding';
import {request} from '../lib/auth';
export default function AlertPreferences({onSaved,user}){
 const [state,setState]=useState(null),[deliveries,setDeliveries]=useState([]),[error,setError]=useState('');
 useEffect(()=>{if(!user)return;let alive=true;Promise.all([request('/alert-preferences',undefined,'GET'),request('/profile',undefined,'GET')]).then(([preferences,profile])=>{if(alive){setState(preferences);setDeliveries(profile.notifications||[]);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[user]);
 if(!user)return <section className="card"><p>Sign in and verify your email to manage your monitoring location and notifications.</p></section>;
 if(!state)return <section className="card"><p role={error?'alert':'status'}>{error||'Loading your monitoring preferences…'}</p></section>;
 const current=state.data?.[0];
 return <div className="alert-preferences-stack"><Onboarding initialStationId={current?.station_id} initialConsent={Boolean(current?.flood_enabled)} onComplete={p=>{setError('Preferences saved.');onSaved?.(p);}}/><p role="status">{error}</p><p className="muted">Email delivery: {state.capabilities?.email_delivery_enabled?'configured':'not enabled'}. Experimental model email notifications are disabled. Source coverage may be incomplete.</p><section className="card account-page alert-delivery-card"><h3>Recent notification deliveries</h3>{deliveries.length?<div className="account-table-scroll"><table><thead><tr><th>Category</th><th>Severity</th><th>Status</th><th>Sent</th></tr></thead><tbody>{deliveries.map(n=><tr key={n.notification_id}><td>{n.alert_type}</td><td>{n.severity}</td><td>{n.status}</td><td>{n.sent_at||'Not sent'}</td></tr>)}</tbody></table></div>:<p className="muted">No notification deliveries recorded for your account.</p>}</section></div>;
}
