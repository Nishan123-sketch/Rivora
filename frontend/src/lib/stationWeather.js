const numeric=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
export function nearestWeather(gauge,stations,weather){
 if(!numeric(gauge?.latitude)||!numeric(gauge?.longitude))return null;
 const rad=n=>n*Math.PI/180;
 return stations.filter(s=>s.data_source==='KMA'&&numeric(s.latitude)&&numeric(s.longitude)).map(s=>{const reading=weather.find(w=>String(w.station_id)===String(s.station_id));const lat=rad(Number(s.latitude)-Number(gauge.latitude)),lon=rad(Number(s.longitude)-Number(gauge.longitude));const distance=6371*2*Math.asin(Math.sqrt(Math.sin(lat/2)**2+Math.cos(rad(Number(gauge.latitude)))*Math.cos(rad(Number(s.latitude)))*Math.sin(lon/2)**2));return {station:s,reading,distance};}).sort((a,b)=>a.distance-b.distance)[0]||null;
}
