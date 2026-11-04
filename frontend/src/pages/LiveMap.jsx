import {useEffect,useRef,useState} from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {metric,observed} from '../lib/format';
import RiskLight from '../components/RiskLight';
import {riskColors} from '../lib/risk';
const located=p=>p&&p.latitude!==null&&p.longitude!==null&&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))&&Math.abs(Number(p.latitude))<=90&&Math.abs(Number(p.longitude))<=180;
export default function LiveMap(){
 const root=useRef(null),map=useRef(null),markers=useRef([]);
 const [rivers,setRivers]=useState([]),[error,setError]=useState(''),[mapError,setMapError]=useState(''),[selected,setSelected]=useState(null),[ready,setReady]=useState(false);
 useEffect(()=>{const c=new AbortController();const load=()=>fetch('/api/map/rivers',{signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.message);return d}).then(d=>{setRivers(d.data||[]);setError('')}).catch(e=>{if(!c.signal.aborted)setError(e.message)});load();const timer=setInterval(load,60000);return()=>{c.abort();clearInterval(timer)}},[]);
 useEffect(()=>{let instance;try{
  instance=new maplibregl.Map({container:root.current,center:[127.8,36.2],zoom:6,pitch:55,bearing:-15,style:{version:8,sources:{basemap:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'},terrain:{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],tileSize:256,maxzoom:15,encoding:'terrarium',attribution:'Terrain: Mapzen / AWS Open Data'}},layers:[{id:'base',type:'raster',source:'basemap'}],terrain:{source:'terrain',exaggeration:1.2}}});
  map.current=instance;instance.addControl(new maplibregl.NavigationControl({visualizePitch:true}));instance.on('load',()=>setReady(true));instance.on('error',()=>setMapError('Some map or terrain tiles could not load. Station details remain available below.'));
 }catch{queueMicrotask(()=>setMapError('3D rendering is not supported by this browser. Station details remain available below.'));}return()=>{instance?.remove();map.current=null;};},[]);
 useEffect(()=>{if(!ready||!map.current)return;markers.current.forEach(m=>m.remove());markers.current=[];
  for(const r of rivers){const points=r.stations.length?r.stations:(r.location?[{...r.location,station_name:'No station data'}]:[]);for(const s of points){if(!located(s))continue;
   const name=`${r.name_en} · ${r.name_ko}`;const box=document.createElement('div');
   for(const text of [name,s.station_name,`Water level: ${metric(s.water_level,'m')}`,`Rainfall: ${metric(s.rainfall,'mm')}`,`Risk: ${s.risk_level||'No risk data'}`,`Last updated: ${observed(s.water_observed_at||s.rainfall_observed_at)} KST`]){const p=document.createElement('p');p.textContent=text;box.appendChild(p);}
   const marker=new maplibregl.Marker({color:riskColors[s.risk_level]||'#9ca3af'}).setLngLat([Number(s.longitude),Number(s.latitude)]).setPopup(new maplibregl.Popup().setDOMContent(box)).addTo(map.current);
   marker.getElement().setAttribute('aria-label',name);marker.getElement().addEventListener('click',()=>setSelected({...s,river_name:name}));markers.current.push(marker);
  }}
 },[rivers,ready]);
 const choose=(r)=>{const s=r.stations.find(located)||r.location||{station_name:'No station data'};setSelected({...s,river_name:`${r.name_en} · ${r.name_ko}`});if(located(s))map.current?.flyTo({center:[Number(s.longitude),Number(s.latitude)],zoom:11,pitch:60});};
 const unlocated=rivers.filter(r=>!r.stations.some(located)&&!located(r.location)).length;
 return <section className="card tall"><h3>3D live river map</h3><p className="muted">Drag to explore · right-drag to tilt · click a traffic light for measurements</p><p>{['High','Moderate','Low'].map(level=><span key={level} style={{marginRight:16}}><RiskLight level={level}/></span>)}<RiskLight label="No station / no risk data"/></p>{error&&<p role="alert">{error}</p>}{mapError&&<p role="status">{mapError}</p>}<div className="map-layout"><div ref={root} className="map-frame" style={{height:540,minHeight:350}}/><aside className="map-side"><h3>{selected?.river_name||'Select a river'}</h3><p>{selected?.station_name||'Click a marker or river below'}</p><p>Water level: {metric(selected?.water_level,'m')}</p><p>Rainfall: {metric(selected?.rainfall,'mm')}</p><p><RiskLight level={selected?.risk_level}/></p><p>Updated: {observed(selected?.water_observed_at||selected?.rainfall_observed_at)} KST</p><div className="map-station-list">{rivers.map(r=><button key={r.river_id} onClick={()=>choose(r)}>{r.name_en} · {r.stations.length?'Station data':'No station data'}</button>)}</div></aside></div><p className="muted">{rivers.length} catalog rivers · {unlocated} without sourced coordinates are listed but cannot be placed on the map. No coordinates are invented. Terrain is geographic elevation, not simulated flood extent. Internet access is required for free public tiles.</p></section>
}
