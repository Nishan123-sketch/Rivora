import {apiFetch} from '../lib/apiFetch.js';
import {useRisk} from '../lib/useRisk';
import {englishRiverName,englishStationName} from '../lib/englishDisplay';
import RiskBadge from '../components/RiskBadge';
import {useEffect,useState} from 'react';
import {parseTime} from '../lib/time';
import '../styles/river-monitoring.css';



function num(v){return v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);}
function labelDate(value){if(!value)return 'No data';const d=parseTime(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d)+' KST':'No data';}
function amount(value,unit='m',places=2){const v=num(value);return v===null?'No data':`${v.toFixed(places)} ${unit}`;}
function RiverChart({readings}){
 const pts=(readings||[]).map(x=>({time:parseTime(x.observed_at).getTime(),level:num(x.water_level)})).filter(p=>Number.isFinite(p.time)&&p.level!==null).sort((a,b)=>a.time-b.time);
 if(pts.length<2)return <div className="river-chart-empty">Collecting readings for this chart.</div>;
 const min=Math.min(...pts.map(x=>x.level)),max=Math.max(...pts.map(x=>x.level));
 const span=Math.max(max-min,0.15),start=pts[0].time,duration=Math.max(1,pts.at(-1).time-start);
 const xy=pts.map(p=>[48+((p.time-start)/duration)*648,188-((p.level-min+span*.12)/(span*1.24))*145]);
 const path=xy.map(([x,y],i)=>`${i?'L':'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
 const area=`${path} L ${xy.at(-1)[0].toFixed(1)} 196 L ${xy[0][0].toFixed(1)} 196 Z`;
 return <div className="river-chart-wrap">
  <svg viewBox="0 0 730 220" role="img" aria-label="Measured river water levels over time" className="river-chart-svg">
   {[0,.5,1].map(f=><line key={f} x1="46" x2="704" y1={25+f*170} y2={25+f*170} stroke="#dfe9ef" strokeDasharray="5 5" />)}
   <text x="6" y="33" fill="#5a7183" fontSize="12">{max.toFixed(2)}</text><text x="6" y="196" fill="#5a7183" fontSize="12">{min.toFixed(2)}</text>
   <path d={area} fill="rgba(10,145,157,.12)"/><path d={path} fill="none" stroke="#0b8590" strokeWidth="3.3" strokeLinejoin="round" strokeLinecap="round"/>
   <circle cx={xy.at(-1)[0]} cy={xy.at(-1)[1]} r="4" fill="#0b8590" stroke="white" strokeWidth="2" />
  </svg>
  <div className="river-chart-axis"><span>{labelDate(pts[0]?.time&&new Date(pts[0].time).toISOString())}</span><span>Measured water level (m)</span><span>{labelDate(pts.at(-1)?.time&&new Date(pts.at(-1).time).toISOString())}</span></div>
 </div>;
}
async function json(url, signal){
 const controller=new AbortController();
 const abort=()=>controller.abort();
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},20000);
 try{
  const r=await apiFetch(url,{signal:controller.signal});
  if(!r.ok)throw Error(`${url}: HTTP ${r.status}`);
  const d=await r.json();if(d.success===false)throw Error(d.message||'Request failed');return d;
 }catch(e){if(timedOut)throw Error(`${url}: no response within 20 seconds`,{cause:e});throw e;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export default function RiverMonitoring(){const {data:risks}=useRisk();const [catalog,setCatalog]=useState([]),[query,setQuery]=useState(''),[riverId,setRiverId]=useState('taehwa'),[stationId,setStationId]=useState(''),[hours,setHours]=useState(24),[history,setHistory]=useState([]),[rain,setRain]=useState(null),[error,setError]=useState('');useEffect(()=>{const c=new AbortController();apiFetch('/api/river-catalog',{signal:c.signal}).then(r=>r.json()).then(d=>setCatalog(d.data||[])).catch(()=>{if(!c.signal.aborted)setError('The river network is reconnecting.')});return()=>c.abort()},[]);const rivers=catalog.filter(r=>`${englishRiverName(r.name_en,r.name_ko)} ${r.name_ko}`.toLowerCase().includes(query.toLowerCase()));const river=rivers.find(r=>r.river_id===riverId)||rivers[0],stations=river?.stations||[],station=stations.find(s=>String(s.station_id)===stationId)||stations[0],id=station?.station_id,assessment=risks.find(s=>String(s.station_id)===String(id));useEffect(()=>{if(!id)return;const c=new AbortController();const load=()=>{Promise.allSettled([json('/api/rivers/'+id+'/history?hours='+hours,c.signal),json('/api/monitoring/stations/'+id+'/rainfall',c.signal)]).then(results=>{if(c.signal.aborted)return;if(results[0].status==='fulfilled'){setHistory(results[0].value.readings||[]);setError('')}else setError('Some recent readings could not refresh.');if(results[1].status==='fulfilled')setRain(results[1].value.data);});};queueMicrotask(()=>{setHistory([]);setRain(null)});load();const timer=setInterval(load,60000);return()=>{c.abort();clearInterval(timer)}},[id,hours]);const latest=assessment?.water_level??station?.water_level;const change=assessment?.rise_1h;const trend=change==null?'Collecting trend':Math.abs(change)<.005?'Steady':change>0?'↗ Rising':'↘ Falling';const fresh=assessment?.data_status==='FRESH';return <div className="river-monitoring-page"><section className="card river-monitoring-hero"><div className="row between river-monitoring-titlebar"><div><p className="caps muted">EXPLORE THE NETWORK</p><h2>River monitoring</h2></div><span className="chip">{catalog.length} waterways</span></div><div className="river-monitoring-stats"><div><strong>{risks.length}</strong><span>Stations monitored</span></div><div><strong>{risks.filter(s=>s.data_status==='FRESH').length}</strong><span>Fresh readings</span></div><div><strong>{risks.filter(s=>['Moderate','High','Severe'].includes(s.level)).length}</strong><span>Elevated river levels</span></div></div><div className="river-selectors"><label>Find a river<input type="search" placeholder="⌕  Search a river name" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>River<select value={river?.river_id||''} onChange={e=>{setRiverId(e.target.value);setStationId('')}}>{rivers.map(r=><option key={r.river_id} value={r.river_id}>{englishRiverName(r.name_en,r.name_ko)}</option>)}</select></label><label>Station<select value={id||''} onChange={e=>setStationId(e.target.value)}>{stations.map(s=><option key={s.station_id} value={s.station_id}>{englishStationName(s.station_name,s.external_station_id)}</option>)}</select></label></div></section>{error&&<p className="notice">{error}</p>}{station?<><div className="river-monitoring-kpis"><section className="card"><p className="caps">WATER LEVEL</p><strong>{amount(latest)}</strong><small className="muted">{labelDate(assessment?.observed_at||station.water_observed_at)}</small></section><section className="card"><p className="caps">RECENT TREND</p><strong>{trend}</strong><small className="muted">{change==null?'More comparable readings are needed':(change>0?'+':'')+amount(change)+' over '+(assessment?.rise_interval_1h_minutes||60)+' minutes'}</small></section><section className="card"><p className="caps">FLOOD-RISK COMPARISON</p><RiskBadge assessment={assessment}/></section><section className="card"><p className="caps">READING STATUS</p><strong className={fresh?'river-fresh':'river-stale'}>{fresh?'Fresh':assessment?.data_status==='STALE'?'Out of date':'Awaiting reading'}</strong><small className="muted">{fresh?'Recent observation received':'Waiting for a recent observation'}</small></section></div><div className="river-content-grid"><section className="card river-chart-panel"><div className="river-panel-header"><div><h3>{englishStationName(station.station_name,station.external_station_id)}</h3><p className="muted">Measured water-level history</p></div><select aria-label="Chart period" value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option></select></div><RiverChart readings={history}/></section><div className="river-side-stack"><section className="card"><h3>Recent level changes</h3>{[[1,'1 hour'],[3,'3 hours'],[6,'6 hours']].map(([h,label])=><div className="river-detail-row" key={h}><span>{assessment?.['rise_interval_'+h+'h_minutes']?assessment['rise_interval_'+h+'h_minutes']+' min':label}</span><b>{assessment?.['rise_'+h+'h']==null?'Collecting readings':(assessment['rise_'+h+'h']>0?'+':'')+amount(assessment['rise_'+h+'h'])}</b></div>)}<p className="forecast-note">Changes compare actual observations.</p></section><section className="card"><h3>Rainfall nearby</h3><strong className="river-rain-value">{rain?.rainfall==null?'Awaiting reading':amount(rain.rainfall,'mm')}</strong><p className="muted">Last hour · {labelDate(rain?.rainfall_observed_at)}</p>{rain?.gauge_name&&<p className="forecast-note">{englishStationName(rain.gauge_name)} · {Number(rain.distance_km).toFixed(1)} km nearby</p>}</section></div></div></>:<p className="notice">Choose a river to view its monitoring stations.</p>}</div>}
