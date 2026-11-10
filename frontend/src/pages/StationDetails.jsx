import {designationLabel} from '../lib/officialDesignation';
import {useEffect,useState} from 'react';
import {apiFetch} from '../lib/apiFetch';
import {useRisk} from '../lib/useRisk';
import {nearestWeather} from '../lib/stationWeather';
import {englishStationName,englishRiverName} from '../lib/englishDisplay';
import '../styles/station-details.css';
import RiskBadge from '../components/RiskBadge';
import {metric,observed,getRow,valid} from '../lib/format';
export default function StationDetails({stationId,stations=[],weather=[],water=[]}){
 const {data:risks}=useRisk();const assessment=risks.find(x=>String(x.station_id)===String(stationId));
 const s=stations.find(x=>String(x.station_id)===String(stationId));const r=getRow(water,stationId);
 const [summary,setSummary]=useState(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();let alive=true;queueMicrotask(()=>{if(alive){setSummary(null);setError('');}});const load=()=>apiFetch('/api/monitoring/stations/'+stationId+'/rainfall',{signal:AbortSignal.any([c.signal,AbortSignal.timeout(15000)])}).then(async response=>{if(!response.ok)throw Error('Linked rainfall service unavailable');return response.json();}).then(d=>{if(alive){setSummary(d.data||null);setError('');}}).catch(e=>{if(alive)setError(e.name==='TimeoutError'?'Linked rainfall request timed out':e.message);});load();const timer=setInterval(load,60000);return()=>{alive=false;c.abort();clearInterval(timer);};},[stationId]);
 if(!s)return <section className="card"><h3>Station unavailable</h3><p>Choose a station from Stations.</p></section>;
 const near=s.data_source==='RIVER_GAUGE'?nearestWeather(s,stations,weather):null;
 const localWeather=getRow(weather,stationId),temperature=localWeather||near?.reading;
 const link=summary?.aws_station_code?summary:assessment?.rainfall_link;
 const rainfall=summary?.rainfall??localWeather?.hourly_rainfall;
 const rainTime=summary?.rainfall_observed_at||localWeather?.observed_at;
 const rainSource=link?`Nearby rain gauge: ${englishStationName(link.gauge_name||link.aws_station_code)}${link.distance_km!=null?' · '+Number(link.distance_km).toFixed(1)+' km away':''}`:s.data_source==='RIVER_GAUGE'?'No rainfall gauge linked':'Station weather observation';
 const tempSource=near?`Nearby weather station: ${englishStationName(near.station.station_name)} · ${near.distance.toFixed(1)} km away`:'Station weather observation';
 const cards=[['WATER LEVEL',metric(r?.water_level??assessment?.water_level,'m'),r?.observed_at||assessment?.observed_at,'Measured water level'],['RAINFALL · HOURLY',valid(rainfall)?metric(rainfall,'mm'):summary===null&&!error?'Loading rainfall…':'Reading unavailable',rainTime,rainSource],['TEMPERATURE',valid(temperature?.temperature)?metric(temperature.temperature,'°C',1):'Reading unavailable',temperature?.observed_at,tempSource]];
 return <><div className="station-detail-page"><section className="card hero-card station-detail-hero"><div><p className="muted caps">STATION {s.station_id}</p><p className="detail-river-name">{englishRiverName(assessment?.river_name_en,assessment?.river_name_ko)}</p><h2>{englishStationName(s.station_name,s.external_station_id)}</h2><p className="detail-designation">{designationLabel(assessment?.station_designation)}</p></div><div className="risk-pill"><small>CURRENT RISK</small><RiskBadge assessment={assessment}/></div></section><div className="grid3">{cards.map(([title,value,time,source])=><div className="card kpi station-detail-metric" key={title}><span className="detail-metric-icon" aria-hidden="true">{title.startsWith('WATER')?'≈':title.startsWith('RAIN')?'☂':'°'}</span><p className="muted caps">{title}</p><strong>{value}</strong><p className="muted">Observed: {time?observed(time)+' KST':'No observation received'}</p><p className="muted">{source}</p></div>)}</div>{error&&<p role="alert">{error}</p>}<section className="card station-detail-info"><h3>Station information</h3><div className="summary-rows"><div><span>Latitude</span><b>{s.latitude??'Unavailable'}</b></div><div><span>Longitude</span><b>{s.longitude??'Unavailable'}</b></div>{valid(r?.flow_rate)&&<div><span>Flow rate (reported)</span><b>{metric(r.flow_rate)}</b></div>}</div><p className="muted">Weather readings reflect nearby stations.</p></section></div></>;
}
