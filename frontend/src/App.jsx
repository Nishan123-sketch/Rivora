import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import './App.css';
import './styles/floodwatch.css';
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
const MLAnalysis=lazy(()=>import('./pages/MLAnalysis'));
import About from './pages/About';
import Login from './pages/Login';
import Register from './pages/Register';
function useTheme(){const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('fw-theme')||''}catch{return ''}});useEffect(()=>{const r=document.documentElement;if(theme)r.setAttribute('data-theme',theme);else r.removeAttribute('data-theme');try{theme?localStorage.setItem('fw-theme',theme):localStorage.removeItem('fw-theme')}catch{/* storage may be disabled */}},[theme]);const dark=theme?theme==='dark':window.matchMedia?.('(prefers-color-scheme: dark)').matches;return [dark,()=>setTheme(dark?'light':'dark')]}
const KMA_CODE='152',RIVER_CODE='2201670';
const API=['/api/stations','/api/weather/latest','/api/water/latest'];
const EYEBROW={'Live Map':'GEOSPATIAL MONITORING','Stations':'MONITORING NETWORK','Station Details':'STATION MONITORING','Historical Data':'TRENDS & HISTORY','River Monitoring':'NATIONWIDE RIVER NETWORK','Alerts':'NOTIFICATIONS','AI Assistant':'DATA-GROUNDED ASSISTANT','ML Analysis':'EXPERIMENTAL PREDICTION MODULE','About':'SYSTEM INFORMATION'};
const titles={'Overview Dashboard':'Overview','Weather Forecast':'Weather & Forecast','Live Map':'Live Map','Stations':'Stations','Station Details':'Station Details','Historical Data':'Historical Data','River Monitoring':'River Monitoring','Alerts':'Alerts','AI Assistant':'Area Condition Assistant','ML Analysis':'ML Analysis','About':'About'};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Fetch one monitoring list. Retries transient failures (network error, timeout, proxy 502/503/504,
// empty 500) with backoff so a briefly busy or still-starting backend does not become a permanent error.
async function fetchList(url,attempts=3){
 let last;
 for(let i=0;i<attempts;i++){
  if(i)await wait(1500*i);
  let r;
  try{r=await fetch(url,{signal:AbortSignal.timeout(20000)})}
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
 const [page,setPage]=useState(window.location.pathname==='/register'?'Register':window.location.pathname==='/login'?'Login':'Overview Dashboard');
 const [stations,setStations]=useState([]),[weather,setWeather]=useState([]),[water,setWater]=useState([]);
 const [stationId,setStationId]=useState('all'),[loading,setLoading]=useState(true),[error,setError]=useState(''),[lastFetched,setLastFetched]=useState(null);
 const navigate=(name)=>{setPage(name);window.history.replaceState({},'',name==='Login'?'/login':name==='Register'?'/register':'/');};
 const busy=useRef(false);
 const loadData=useCallback(async()=>{
  if(busy.current)return;
  busy.current=true;
  try{
   const results=await Promise.allSettled(API.map(url=>fetchList(url)));
   const setters=[setStations,setWeather,setWater];
   // Keep the last good data on a failed refresh instead of blanking the screen.
   results.forEach((r,i)=>{if(r.status==='fulfilled')setters[i](r.value)});
   setError(results.filter(r=>r.status==='rejected').map(r=>r.reason.message).join('; '));
   setLastFetched(new Date());setLoading(false);
  }finally{busy.current=false}
 },[]);
 useEffect(()=>{const first=setTimeout(loadData,0);const id=setInterval(loadData,60000);return()=>{clearTimeout(first);clearInterval(id)}},[loadData]);
 useEffect(()=>{if(!error||stations.length)return;const t=setTimeout(loadData,10000);return()=>clearTimeout(t)},[error,stations.length,lastFetched,loadData]);
  const [detailId,setDetailId]=useState(null),[menuOpen,setMenuOpen]=useState(false);
 const [dark,toggleTheme]=useTheme();
 const [prediction,setPrediction]=useState(null);
 const ulsan=stations.find(s=>s.data_source==='KMA'&&String(s.external_station_id)===KMA_CODE)||stations.find(s=>s.data_source==='KMA'&&/울산|ulsan/i.test(s.station_name||''));
 const taehwa=stations.find(s=>s.data_source==='RIVER_GAUGE'&&String(s.external_station_id)===RIVER_CODE)||stations.find(s=>s.data_source==='RIVER_GAUGE'&&/태화|taehwa/i.test(s.station_name||''));
 const ulsanId=ulsan?String(ulsan.station_id):null,riverId=taehwa?String(taehwa.station_id):null;
 useEffect(()=>{if(!riverId){return}let active=true;const load=()=>fetch('/api/rivers/'+riverId+'/prediction').then(r=>{if(!r.ok)throw new Error('prediction unavailable');return r.json()}).then(d=>{if(active)setPrediction(d)}).catch(()=>{if(active)setPrediction(null)});load();const timer=setInterval(load,60000);return()=>{active=false;clearInterval(timer)}},[riverId]);
 const shared={stations,weather,water,stationId,setStationId,prediction,ulsanId,riverId};
 const openDetails=(station)=>{setDetailId(station.station_id);navigate('Station Details')};
 const renderPage=()=>{switch(page){case 'Overview Dashboard':return <Dashboard {...shared}/>;case 'Weather Forecast':return <WeatherForecast {...shared}/>;case 'Live Map':return <LiveMap {...shared}/>;case 'Stations':return <Stations {...shared} openDetails={openDetails}/>;case 'Station Details':return <StationDetails {...shared} stationId={detailId}/>;case 'Historical Data':return <HistoricalData {...shared}/>;case 'River Monitoring':return <RiverMonitoring {...shared}/>;case 'Alerts':return <Alerts {...shared}/>;case 'AI Assistant':return <AIAssistant {...shared}/>;case 'ML Analysis':return <MLAnalysis riverId={riverId}/>;case 'About':return <About/>;default:return null}};
 if(page==='Login')return <Login onRegister={()=>navigate('Register')} onExplore={()=>navigate('Overview Dashboard')}/>;
 if(page==='Register')return <Register onLogin={()=>navigate('Login')}/>;
 return <div className="app-layout"><Sidebar page={page} setPage={navigate} open={menuOpen} onClose={()=>setMenuOpen(false)}/><main className="main-content"><header className="topbar"><div className="topbar-left"><button type="button" className="menu-toggle" aria-label="Open menu" aria-controls="main-sidebar" aria-expanded={menuOpen} onClick={()=>setMenuOpen(true)}>☰</button><div><p className="eyebrow">{EYEBROW[page]||'LIVE ENVIRONMENTAL INTELLIGENCE'}</p><h1>{titles[page]||page}</h1></div></div><div className="topbar-actions"><button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={dark?'Switch to light mode':'Switch to dark mode'} title={dark?'Light mode':'Dark mode'}>{dark?'☀':'☾'}</button><button className="refresh-button" type="button" onClick={loadData} aria-label="Refresh data"><i>↻</i><span>{lastFetched?'Updated '+lastFetched.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'Refresh'}</span></button></div></header><div className="page-body">{error&&<div className="error-banner">Unable to refresh monitoring data: {error} <button onClick={loadData}>Retry</button></div>}{loading&&<p className="muted" role="status">Connecting to monitoring data… Pages remain available while the backend responds.</p>}<Suspense fallback={<p className="muted" role="status">Loading page…</p>}>{renderPage()}</Suspense></div></main></div>;
}
