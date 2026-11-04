import RiskLight from '../components/RiskLight';
import {useEffect,useMemo,useState} from 'react';
import {parseTime} from '../lib/time';
import '../styles/river-monitoring.css';
import RiverPredictionCard from '../components/RiverPredictionCard';

const HOUR=3600000;
function num(v){return v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);}
function labelDate(value){if(!value)return 'No data';const d=parseTime(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d)+' KST':'No data';}
function amount(value,unit='m',places=2){const v=num(value);return v===null?'No data':`${v.toFixed(places)} ${unit}`;}
function freshness(value){if(!value)return 'NO DATA';const d=parseTime(value).getTime();if(!Number.isFinite(d))return 'NO DATA';const h=(Date.now()-d)/HOUR;return h>=-.3&&h<=3?'FRESH':'STALE';}
function RiverChart({readings}){
 const pts=(readings||[]).map(x=>({time:parseTime(x.observed_at).getTime(),level:num(x.water_level)})).filter(p=>Number.isFinite(p.time)&&p.level!==null).sort((a,b)=>a.time-b.time);
 if(pts.length<2)return <div className="river-chart-empty">At least two valid water-level observations are needed for a chart.</div>;
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
  const r=await fetch(url,{signal:controller.signal});
  if(!r.ok)throw Error(`${url}: HTTP ${r.status}`);
  const d=await r.json();if(d.success===false)throw Error(d.message||'Request failed');return d;
 }catch(e){if(timedOut)throw Error(`${url}: no response within 20 seconds`);throw e;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export default function RiverMonitoring({weather=[]}){
 const [catalog,setCatalog]=useState([]),[catalogError,setCatalogError]=useState('');
 const [region,setRegion]=useState('ulsan'),[query,setQuery]=useState('');
 const [preferredRiverId,setRiverId]=useState('taehwa'),[stationId,setStationId]=useState('');
 const [summary,setSummary]=useState(null),[official,setOfficial]=useState(null);
 const [risk,setRisk]=useState(null),[history,setHistory]=useState([]),[hours,setHours]=useState(24);
 const [loading,setLoading]=useState(false),[detailError,setDetailError]=useState('');
 const [refreshIndex,setRefreshIndex]=useState(0);
 useEffect(()=>{
  const c=new AbortController();
  const load=async()=>{try{const d=await json('/api/river-catalog',c.signal);if(!c.signal.aborted){setCatalog(d.data||[]);setCatalogError('');}}catch(e){if(!c.signal.aborted)setCatalogError(e.message);}};
  load();const interval=setInterval(load,60000);
  return()=>{c.abort();clearInterval(interval)};
 },[refreshIndex]);
 const regions=useMemo(()=>[...new Map(catalog.map(r=>[r.region_id,r.region])).entries()],[catalog]);
 const matching=catalog.filter(r=>(region==='all'||r.region_id===region)&&(!query||`${r.name_ko} ${r.name_en}`.toLowerCase().includes(query.toLowerCase())));
 // Only offer rivers with a real linked gauge as selectable monitoring targets.
 const filtered=matching.filter(r=>r.stations?.length>0);
 const awaitingCount=0;
 const riverId=filtered.some(r=>r.river_id===preferredRiverId)?preferredRiverId:(filtered[0]?.river_id||'');
 const chosen=filtered.find(r=>r.river_id===riverId)||null;
 const stations=chosen?.stations||[];
 const station=stations.find(s=>String(s.station_id)===stationId)||stations[0]||null;
 const selectedGaugeId=station?.station_id||null;
 useEffect(()=>{
  if(!selectedGaugeId){queueMicrotask(()=>{setHistory([]);setRisk(null);setSummary(null);setOfficial(null);setDetailError('')});return;}
  const c=new AbortController();
  setRisk(null);setHistory([]);setSummary(null);setOfficial(null);setDetailError('');
  let running=false;
  async function load(){if(running)return;running=true;setLoading(true);try{
    const [riskData,historyData,summaryData,officialData]=await Promise.allSettled([
      json(`/api/rivers/${selectedGaugeId}/risk`,c.signal),
      json(`/api/rivers/${selectedGaugeId}/history?hours=${hours}`,c.signal),
      json(`/api/monitoring/stations`,c.signal),json(`/api/official-alerts`,c.signal)
    ]);
    if(!c.signal.aborted){
      setSummary(summaryData.status==='fulfilled'?(summaryData.value.data||[]).find(x=>String(x.station_id)===String(selectedGaugeId))||null:null);
      setOfficial(officialData.status==='fulfilled'?officialData.value:null);
      setRisk(riskData.status==='fulfilled'?riskData.value:null);
      setHistory(historyData.status==='fulfilled'?historyData.value.readings||[]:[]);
      const results=[riskData,historyData,summaryData,officialData];
      const labels=['Water level and risk','History','Assessment summary','Official alerts'];
      setDetailError(results.flatMap((r,i)=>r.status==='rejected'?[`${labels[i]}: ${r.reason.message}`]:[]).join('; '));
    }
  }catch(e){if(!c.signal.aborted){setRisk(null);setHistory([]);setSummary(null);setOfficial(null);setDetailError(e.message);}}
  finally{running=false;if(!c.signal.aborted)setLoading(false);}}
  load();const interval=setInterval(load,60000);return()=>{c.abort();clearInterval(interval)};
 },[selectedGaugeId,hours,refreshIndex]);
 const monitored=catalog.filter(r=>r.stations.length>0).length;
 const active= catalog.filter(r=>r.stations.some(s=>freshness(s.latest_observed_at)==='FRESH')).length;
 const latest=risk?.latest_observation;
 const currentStatus=!station?'NO GAUGE':!risk?(loading?'LOADING':'UNAVAILABLE'):num(latest?.water_level_m)===null?'NO DATA':freshness(latest?.observed_at);
 const classified=risk?.assessment_status==='ASSESSED';
 const rainWeather=weather.find(w=>String(w.aws_station_code)==='152')||null;
 const rainCurrent=chosen?.region_id==='ulsan'&&rainWeather&&freshness(rainWeather.aws_observed_at)==='FRESH';
 const regionalRain=rainCurrent?num(rainWeather.aws_hourly_rainfall):null;
 const change=risk?.river_trend?.changes?.['1h'];
 return <div className="river-monitoring-page">
  <section className="card river-monitoring-head">
   <div className="river-heading"><div><p className="caps">NATIONWIDE MONITORING NETWORK</p><h3>River monitoring</h3><p className="muted">{catalog.length} catalog waterways across South Korea. Only linked gauges provide verified WAMIS observations; flood risk requires separately verified thresholds.</p></div><button type="button" onClick={()=>setRefreshIndex(v=>v+1)} className="river-refresh">Refresh observations</button></div>
   <div className="river-coverage"><div><strong>{catalog.length||0}</strong><span>Rivers in catalog</span></div><div><strong>{monitored}</strong><span>With linked gauges</span></div><div><strong>{catalogError?'Unavailable':active}</strong><span>With fresh observations</span></div></div>
   {catalogError&&<p className="river-warning">Catalog refresh failed: {catalogError}. Previously loaded selections may still be shown. Check the backend connection, then use Refresh observations.</p>}
   <div className="river-selectors">
    <label>Region<select value={region} onChange={e=>setRegion(e.target.value)}><option value="all">All South Korea</option>{regions.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <label>Search river<input type="search" placeholder="e.g. 태화강, Han" value={query} onChange={e=>setQuery(e.target.value)} /></label>
    <label>River<select value={filtered.some(r=>r.river_id===riverId)?riverId:''} onChange={e=>{setRiverId(e.target.value);setStationId('')}}>{!filtered.length&&<option value="">No linked river gauges in this selection</option>}{filtered.map(r=><option key={r.river_id} value={r.river_id}>{r.name_ko} · {r.name_en} {`(${r.stations.length} ${r.stations.length===1?'gauge':'gauges'})`}</option>)}</select></label>
    <label>Monitoring station<select value={station?.station_id||''} disabled={!stations.length} onChange={e=>setStationId(e.target.value)}>{stations.length?stations.map(s=><option value={s.station_id} key={s.station_id}>{s.station_name} · {s.external_station_id}</option>):<option value="">No verified station</option>}</select></label>
   </div>
   {awaitingCount>0&&<p className="muted">{awaitingCount} catalog {awaitingCount===1?'river is':'rivers are'} without a confirmed WAMIS gauge: No station data.</p>}
  </section>
  {!station?<section className="card river-unlinked"><div className="river-empty-icon">◌</div><div><h3>{chosen?`${chosen.name_ko} · ${chosen.name_en}`:'Choose a river'}</h3><p className="muted">No officially verified WAMIS water-level gauge is linked to this river yet. No station data.</p><p className="muted">The bundled <code>npm run rivers:setup</code> command searches official station metadata and links gauges only after checking their river identities and actual readings.</p></div></section>:<>
   <div className="river-monitoring-kpis">
    <section className="card"><p className="caps">WATER LEVEL</p><strong>{amount(latest?.water_level_m)}</strong><small className="muted">{labelDate(latest?.observed_at)}</small></section>
    <section className="card"><p className="caps">RIVER TREND</p><strong>{risk?.river_trend?.trend||'No data'}</strong><small className="muted">1-hour change: {amount(change)}</small></section>
    <section className="card"><p className="caps">FLOOD-RISK STATUS</p><strong className={classified?'river-risk-available':'river-risk-unknown'}><RiskLight level={summary?.risk_level}/></strong><small className="muted">Stages: {risk?.flood_thresholds?.verification_status||'Unverified'}</small></section>
    <section className="card"><p className="caps">OBSERVATION FRESHNESS</p><strong className={currentStatus==='FRESH'?'river-fresh':'river-stale'}>{currentStatus}</strong><small className="muted">Freshness limit: 3 hours</small></section>
   </div>
   
{detailError && (
  <p className="river-warning">
    Some station data could not load: {detailError}
  </p>
)}

{/* Every verified gauge has a baseline where its data is sufficient. */}
<RiverPredictionCard key={station.station_id} stationId={station.station_id} stationName={station.station_name} gaugeCode={station.external_station_id} />

<div className="river-content-grid">

    <section className="card river-chart-panel"><div className="river-panel-header"><div><h3>{station.station_name} · Water-level history</h3><p className="muted">Official WAMIS station {station.external_station_id} · water level in metres</p></div><select aria-label="Chart period" value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={24}>24 hours</option><option value={72}>72 hours</option><option value={168}>7 days</option></select></div>{loading&&<p className="muted">Refreshing observations…</p>}<RiverChart readings={history}/><div className="river-chart-legend"><span className="river-line-dot"/>Measured stage only — not a prediction or warning</div></section>
    <div className="river-side-stack">
     <section className="card"><h3>Assessment details</h3><p>Saved next-hour level: {amount(summary?.prediction?.predicted_water_level)}</p><p>ML score: {summary?.risk_score??'No risk data'}</p><p>{summary?.prediction?.reason}</p><div className="river-detail-row"><span>Water-level trend (3h)</span><b>{amount(risk?.river_trend?.changes?.['3h'])}</b></div><div className="river-detail-row"><span>Water-level trend (6h)</span><b>{amount(risk?.river_trend?.changes?.['6h'])}</b></div><div className="river-detail-row"><span>Threshold verification</span><b>{summary?.threshold_verification||'Not Verified'}</b></div><div className="river-detail-row"><span>Official warning feed</span><b>{official?.status||'No official feed data'}</b></div><p className="muted river-note">Flood-risk classification requires recent water levels and independently verified gauge-specific thresholds.</p></section>
     <section className="card"><h3>Rainfall context</h3>{chosen?.region_id==='ulsan'?<><strong className="river-rain-value">{regionalRain===null?'No data':amount(regionalRain,'mm',2)}</strong><p className="muted">Ulsan AWS station 152 · observed hourly rainfall. This is a regional reference, not a measurement at the river gauge.</p><p className="muted">{labelDate(rainWeather?.aws_observed_at)}</p></>:<p className="muted">A location-matched, verified rainfall station is not linked to this gauge. Rainfall is not inferred from a nearby or unrelated station.</p>}</section>
    </div>
   </div>
   <section className="card river-gauge-meta"><h3>Official monitoring station</h3><div className="river-detail-row"><span>Gauge code</span><b>{station.external_station_id}</b></div><div className="river-detail-row"><span>River</span><b>{chosen?.name_ko} · {chosen?.name_en}</b></div><div className="river-detail-row"><span>Coordinates</span><b>{Number(station.latitude).toFixed(5)}, {Number(station.longitude).toFixed(5)}</b></div>{station.reference_url&&<a href={station.reference_url} target="_blank" rel="noopener noreferrer">View source station information</a>}</section>
  </>}
  <section className="card river-disclaimer"><strong>Educational monitoring only.</strong> Rivers on this page are monitoring priorities, not a ranked list of dangerous rivers. Gauge identity verification does not verify warning thresholds. Stale data, missing gauges and unverified stages must never be presented as safe conditions or official flood warnings.</section>
 </div>;
}
