import {englishStationName} from './lib/englishDisplay';
import {appDataIndices} from './lib/pageData';
import {recordPagePerformance} from './lib/clientPerformance';
import {readLocation,pageUrl} from './lib/navigation';
import {apiFetch} from './lib/apiFetch.js';
import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import './App.css';
import './styles/floodwatch.css';
import './styles/rivora-refresh.css';
import './styles/compact-ui.css';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
const WeatherForecast=lazy(()=>import('./pages/WeatherForecast'));
const LiveMap=lazy(()=>import('./pages/LiveMap'));
import Stations from './pages/Stations';
import StationDetails from './pages/StationDetails';
import HistoricalData from './pages/HistoricalData';
const RiverMonitoring=lazy(()=>import('./pages/RiverMonitoring'));
import Alerts from './pages/Alerts';
const AIAssistant=lazy(()=>import('./pages/AIAssistant'));
const MLAnalysis=lazy(()=>import('./pages/MLAdvanced'));
import About from './pages/About';
import Login from './pages/Login';
import AccountMenu from './components/AccountMenu';
import Profile from './pages/Profile';
import AccountAction from './pages/AccountAction';
const Admin=lazy(()=>import('./pages/Admin'));
import './styles/accounts.css';

import AuthCallback from './pages/AuthCallback';
import Onboarding from './pages/Onboarding';
import AlertPreferences from './pages/AlertPreferences';
import {request,token} from './lib/auth';
import Register from './pages/Register';
function useLightTheme(){useEffect(()=>{document.documentElement.setAttribute('data-theme','light');try{localStorage.setItem('fw-theme','light')}catch{/* storage disabled */}},[])}
const KMA_CODE='152',RIVER_CODE='2201670';
const API=['/api/stations','/api/weather/latest','/api/water/latest'];
const EYEBROW={'Live Map':'GEOSPATIAL MONITORING','Stations':'MONITORING NETWORK','Station Details':'STATION MONITORING','Historical Data':'TRENDS & HISTORY','River Monitoring':'NATIONWIDE RIVER NETWORK','Alerts':'NOTIFICATIONS','AI Assistant':'YOUR LOCAL ASSISTANT','ML Analysis':'EXPERIMENTAL PREDICTION MODULE','About':'SYSTEM INFORMATION'};
const titles={'Overview Dashboard':'Overview','Weather Forecast':'Weather & Forecast','Live Map':'Live Map','Stations':'Stations','Station Details':'Station Details','Historical Data':'Historical Data','River Monitoring':'River Monitoring','Alerts':'Alerts','AI Assistant':'Rivora Assist','ML Analysis':'ML Analysis','About':'About'};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Fetch one monitoring list. Retries transient failures (network error, timeout, proxy 502/503/504,
// empty 500) with backoff so a briefly busy or still-starting backend does not become a permanent error.
async function fetchList(url,attempts=3){
 let last;
 for(let i=0;i<attempts;i++){
  if(i)await wait(1500*i);
  let r;
  try{r=await apiFetch(url,{signal:AbortSignal.timeout(20000)})}
  catch(e){last=new Error(`${url}: ${e?.name==='TimeoutError'?'no answer within 20 s (backend busy or database not responding)':'cannot reach the server (is the backend running? cd backend && npm run dev)'}`);continue}
  if(!r.ok){
   let m='';try{m=(await r.json()).message||''}catch{/* empty or non-JSON body */}
   last=new Error(`${url}: HTTP ${r.status}${m?' ('+m+')':''}`);
   if(r.status>=502||(r.status===500&&!m))continue;
   throw last;
  }
  const d=await r.json().catch(()=>null);
  if(!d||d.success!==true||!Array.isArray(d.data))throw new Error(`${url}: invalid data`);
  return d.data;
 }
 throw last;
}
export default function App(){
 const [initial]=useState(()=>readLocation(window.location,import.meta.env.BASE_URL));
 const [page,setPage]=useState(initial.page);
 const [preferenceLoading,setPreferenceLoading]=useState(true);
 const [account,setAccount]=useState({user:null,guest:null}),[guestSeconds,setGuestSeconds]=useState(0);
 const [preference,setPreference]=useState(null),[preferenceError,setPreferenceError]=useState(''),[preferenceRevision,setPreferenceRevision]=useState(0);
 const [splash,setSplash]=useState(()=>initial.page==='Auth Callback'?'done':'visible');
 useEffect(()=>{if(splash==='done')return;const timer=setTimeout(()=>setSplash(splash==='visible'?'leaving':'done'),splash==='visible'?1800:350);return()=>clearTimeout(timer);},[splash]);
 const [stations,setStations]=useState([]),[weather,setWeather]=useState([]),[water,setWater]=useState([]);
 const [stationId,setStationId]=useState('all'),[loading,setLoading]=useState(true),[error,setError]=useState(''),[lastFetched,setLastFetched]=useState(null);
  const [detailId,setDetailId]=useState(initial.detailId),[menuOpen,setMenuOpen]=useState(false);
 const navigate=(name,id=null)=>{if(name==='Login'&&!token()){setPreference(null);setStationId('all');}if(name===page&&id===detailId)return;window.history.pushState({},'',pageUrl(name,id,import.meta.env.BASE_URL));setDetailId(id);setPage(name);setMenuOpen(false);};
 useEffect(()=>{let alive=true;request('/auth/session',undefined,'GET').then(async d=>{if(!alive)return;setAccount(d);if(d.guest)setGuestSeconds(Math.max(0,Math.ceil((Date.parse(d.guest.expires_at)-Date.now())/1000)));const current=readLocation(window.location,import.meta.env.BASE_URL).page;if(d.user){if(d.user.must_change_password){setPage('Profile');window.history.replaceState({},'',pageUrl('Profile'));return;}const p=await request('/alert-preferences',undefined,'GET');if(!alive)return;const selected=p.data?.[0]||null;setPreference(selected);if(selected)setStationId(String(selected.station_id));if(current==='Login'){setPage('Overview Dashboard');window.history.replaceState({},'',pageUrl('Overview Dashboard'));}}else if(!d.guest&&!['Login','Register','Auth Callback','Account Action','Admin','Admin Login'].includes(current)){setPage('Login');window.history.replaceState({},'',pageUrl('Login'));}}).catch(e=>{if(alive)setPreferenceError(e.message);}).finally(()=>{if(alive)setPreferenceLoading(false);});return()=>{alive=false;};},[preferenceRevision]);
 useEffect(()=>{if(!account.guest||account.user)return;const tick=()=>{const seconds=Math.max(0,Math.ceil((Date.parse(account.guest.expires_at)-Date.now())/1000));setGuestSeconds(seconds);if(!seconds){setAccount({user:null,guest:null});setPage('Login');window.history.replaceState({},'',pageUrl('Login')+'?preview_expired=1');}};const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[account.guest,account.user]);
 useEffect(()=>{if(preferenceLoading||['Login','Register','Auth Callback','Account Action'].includes(page))return;const timer=setInterval(()=>{request('/auth/session',undefined,'GET').then(d=>{if(!d.user&&!d.guest){setAccount(d);setPage('Login');window.history.replaceState({},'',pageUrl('Login'));}}).catch(()=>{});},15000);return()=>clearInterval(timer);},[page,preferenceLoading]);
 const accountUpdated=()=>{setPreferenceLoading(true);setPreferenceRevision(v=>v+1);};
 const logout=async()=>{try{await request('/auth/logout',{});}catch{setPreferenceError('Logout could not reach the server. Retry to revoke your sessions.');return false;}sessionStorage.removeItem('weather_flood_token');setAccount({user:null,guest:null});setPreference(null);navigate('Login');return true;};
 const loginComplete=(target,p)=>{setPreference(p||null);setStationId(p?String(p.station_id):'all');accountUpdated();navigate(typeof target==='string'?target:'Overview Dashboard');};
 const signedIn=(p)=>{setPreference(p);setStationId(p?String(p.station_id):'all');accountUpdated();navigate('Overview Dashboard');};
 useEffect(()=>{const restore=()=>{const state=readLocation(window.location,import.meta.env.BASE_URL);setPage(state.page);setDetailId(state.detailId);setMenuOpen(false);};window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[]);
 useEffect(()=>{document.querySelector('.main-content')?.scrollTo({top:0,left:0})},[page]);
 const busy=useRef(false),queued=useRef(false),currentLoader=useRef(null);
 const loadData=useCallback(async()=>{
  if(busy.current){queued.current=true;return;}
  busy.current=true;
  try{
   const indices=appDataIndices(page);const setters=[setStations,setWeather,setWater];
   const results=await Promise.allSettled(indices.map(i=>fetchList(API[i]).then(rows=>{setters[i](rows);return rows;})));
   // Keep the last good data on a failed refresh instead of blanking the screen.
   
   setError(results.filter(r=>r.status==='rejected').map(r=>r.reason.message).join('; '));
   setLastFetched(new Date());setLoading(false);recordPagePerformance('app-data-ready');
  }finally{busy.current=false;if(queued.current){queued.current=false;queueMicrotask(()=>currentLoader.current?.());}}
 },[page]);
 useEffect(()=>{currentLoader.current=loadData;},[loadData]);
 useEffect(()=>{const first=setTimeout(loadData,0);const id=setInterval(()=>{if(document.visibilityState!=='hidden')loadData();},60000);return()=>{clearTimeout(first);clearInterval(id)}},[loadData]);
 useEffect(()=>{if(!error||stations.length)return;const t=setTimeout(loadData,10000);return()=>clearTimeout(t)},[error,stations.length,lastFetched,loadData]);
 useLightTheme();
 const [prediction,setPrediction]=useState(null);
 const ulsan=stations.find(s=>s.data_source==='KMA'&&String(s.external_station_id)===KMA_CODE)||stations.find(s=>s.data_source==='KMA'&&/울산|ulsan/i.test(s.station_name||''));
 const taehwa=stations.find(s=>s.data_source==='RIVER_GAUGE'&&String(s.external_station_id)===RIVER_CODE)||stations.find(s=>s.data_source==='RIVER_GAUGE'&&/태화|taehwa/i.test(s.station_name||''));
 const ulsanId=ulsan?String(ulsan.station_id):null,riverId=preference?String(preference.station_id):taehwa?String(taehwa.station_id):null;
 useEffect(()=>{if(!riverId||!['Overview Dashboard','Weather Forecast'].includes(page)){return}let active=true;const load=()=>apiFetch('/api/rivers/'+riverId+'/prediction').then(r=>{if(!r.ok)throw new Error('prediction unavailable');return r.json()}).then(d=>{if(active)setPrediction(d)}).catch(()=>{if(active)setPrediction(null)});load();const timer=setInterval(load,60000);return()=>{active=false;clearInterval(timer)}},[riverId,page]);
 const shared={stations,weather,water,stationId,setStationId,prediction,ulsanId,riverId,user:account.user};
 const openDetails=(station)=>navigate('Station Details',station.station_id);
 const renderPage=()=>{switch(page){case 'Profile':return account.user?<Profile onUpdated={accountUpdated}/>:<p>Sign in to access your profile.</p>;case 'Admin':return account.user?.role==='ADMIN'?<Admin/>:<p>Administrator access required.</p>;case 'Overview Dashboard':return <>{preference&&<section className="card monitoring-welcome"><div><h3>Your monitoring station</h3><p>{stations.find(s=>String(s.station_id)===String(preference.station_id))?.station_name?englishStationName(stations.find(s=>String(s.station_id)===String(preference.station_id)).station_name):'Station '+preference.station_id} · Official-warning emails {preference.flood_enabled?'enabled':'disabled'}</p></div><button onClick={()=>navigate('Onboarding')}>Change location or alerts</button></section>}<Dashboard {...shared} riverName={englishStationName(stations.find(s=>String(s.station_id)===String(riverId))?.station_name||'Monitoring station')} personalized={Boolean(preference)}/></>;case 'Weather Forecast':return <WeatherForecast {...shared}/>;case 'Live Map':return <LiveMap {...shared}/>;case 'Stations':return <Stations {...shared} openDetails={openDetails}/>;case 'Station Details':return <StationDetails {...shared} stationId={detailId}/>;case 'Historical Data':return <HistoricalData {...shared}/>;case 'River Monitoring':return <RiverMonitoring {...shared}/>;case 'Onboarding':return <Onboarding key={preference?.station_id||'new'} initialStationId={preference?.station_id} initialConsent={Boolean(preference?.flood_enabled)} onComplete={signedIn}/>;case 'Auth Callback':return <AuthCallback onComplete={signedIn} onLogin={()=>navigate('Login')}/>;case 'Alerts':return <><Alerts {...shared}/><AlertPreferences user={account.user} onSaved={p=>{setPreference(p);setStationId(String(p.station_id));}}/></>;case 'AI Assistant':return <AIAssistant {...shared}/>;case 'ML Analysis':return <MLAnalysis riverId={riverId}/>;case 'About':return <About/>;default:return null}};
 if(splash!=='done')return <div className={'rivora-splash premium-splash '+(splash==='leaving'?'splash-leaving':'')} aria-label="Rivora welcome screen"><div className="splash-orbit" aria-hidden="true"/><div className="splash-brand"><span className="splash-symbol" aria-hidden="true">≋</span><h1>Rivora</h1><p>WATER • WEATHER • RISK</p><span className="splash-progress" aria-hidden="true"/><small role="status">A clearer view of changing conditions</small></div><button className="splash-skip" onClick={()=>setSplash('leaving')}>Continue →</button></div>;
 if(preferenceLoading&&!preferenceError)return <section className="card" role="status">Loading your monitoring location…</section>;
 if(preferenceError)return <section className="card"><h2>Could not load your monitoring preferences</h2><p role="alert">{preferenceError}</p><button onClick={()=>{setPreferenceError('');setPreferenceLoading(true);setPreferenceRevision(v=>v+1);}}>Retry</button><button onClick={()=>{sessionStorage.removeItem('weather_flood_token');setPreferenceLoading(false);setAccount({user:null,guest:null});setPreferenceError('');setPreference(null);navigate('Login');}}>Sign in again</button></section>;
 if(page==='Admin'||page==='Admin Login'){if(account.user?.role==='ADMIN')return <Suspense fallback={<p role="status">Loading protected admin workspace…</p>}><Admin user={account.user} onReturn={()=>navigate('Overview Dashboard')} onLogout={async()=>{if(await logout())navigate('Admin Login');}} onUpdated={accountUpdated}/></Suspense>;return <Login adminOnly onRegister={()=>navigate('Register')} onExplore={loginComplete}/>;}
 if(page==='Login')return <Login onRegister={()=>navigate('Register')} onExplore={loginComplete}/>;
 if(account.guest&&['Profile','Onboarding','Admin'].includes(page))return <Login onRegister={()=>navigate('Register')} onExplore={loginComplete}/>;
 if(page==='Account Action')return <AccountAction onLogin={()=>navigate('Login')}/>;
 if(!preferenceLoading&&!account.user&&!account.guest&&!['Login','Register','Auth Callback'].includes(page))return <Login onRegister={()=>navigate('Register')} onExplore={loginComplete}/>;
 if(page==='Register')return <Register onLogin={()=>navigate('Login')}/>;
 return <div className="app-layout"><Sidebar user={account.user} onLogout={logout} page={page} setPage={navigate} open={menuOpen} onClose={()=>setMenuOpen(false)}/><main className="main-content"><header className="topbar"><div className="topbar-left"><button type="button" className="menu-toggle" aria-label="Open menu" aria-controls="main-sidebar" aria-expanded={menuOpen} onClick={()=>setMenuOpen(true)}>☰</button><div><p className="eyebrow">{EYEBROW[page]||'LIVE ENVIRONMENTAL INTELLIGENCE'}</p><h1>{titles[page]||page}</h1></div></div><div className="topbar-actions">{account.guest&&!account.user&&<span className="guest-countdown" role="timer" aria-label="Guest preview remaining">Preview {Math.floor(guestSeconds/60)}:{String(guestSeconds%60).padStart(2,'0')}</span>}{account.user&&<AccountMenu user={account.user} onNavigate={navigate} onLogout={logout}/>}<button className="refresh-button" type="button" onClick={loadData} aria-label="Refresh data"><i>↻</i><span>{lastFetched?'Page refreshed '+lastFetched.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'Refresh'}</span></button></div></header><div className="page-body">{error&&<div className="error-banner">Some readings could not refresh. Your last readings remain available. <button onClick={loadData}>Retry</button></div>}{loading&&<p className="muted" role="status">Connecting to monitoring data… Pages remain available while the backend responds.</p>}<Suspense fallback={<p className="muted" role="status">Loading page…</p>}>{renderPage()}</Suspense></div></main></div>;
}
