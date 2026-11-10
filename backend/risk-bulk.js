'use strict';
const key=v=>String(v);const group=(rows,field)=>{const m=new Map();for(const r of rows){const k=key(r[field]);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
async function bulkAssess(db,now,evaluate){
 const kst=t=>new Date(t+9*3600000).toISOString().slice(0,19).replace('T',' ');
 const [[stations],[latest],[thresholds],[history],[links],[rain],[forecasts]]=await Promise.all([
 db.query("SELECT * FROM stations WHERE data_source='RIVER_GAUGE' ORDER BY station_id"),
 db.query("SELECT w.station_id,w.observed_at,w.water_level,w.source_url FROM stations s JOIN (SELECT station_id,MAX(observed_at) observed_at FROM water_readings GROUP BY station_id) lw ON lw.station_id=s.station_id JOIN water_readings w ON w.station_id=lw.station_id AND w.observed_at=lw.observed_at WHERE s.data_source='RIVER_GAUGE'"),
 db.query('SELECT * FROM flood_thresholds'),
 db.execute('SELECT station_id,observed_at,water_level FROM water_readings WHERE observed_at>=? ORDER BY station_id,observed_at',[kst(now-10*3600000)]),
 db.query("SELECT * FROM station_rainfall_links WHERE verification_status IN ('VERIFIED','AUTO_NEAREST')"),
 db.execute('SELECT aws_station_code,observed_at,hourly_rainfall FROM aws_rainfall_readings WHERE observed_at>=? ORDER BY observed_at DESC',[kst(now-15*3600000)]),
 db.query("SELECT s.external_station_id AS aws_station_code,f.valid_at,f.rainfall_forecast FROM stations s JOIN (SELECT station_id,MAX(issued_at) issued_at FROM weather_forecasts GROUP BY station_id) i ON i.station_id=s.station_id JOIN weather_forecasts f ON f.station_id=i.station_id AND f.issued_at=i.issued_at WHERE s.data_source='KMA' ORDER BY f.valid_at DESC")]);
 const byLatest=new Map(latest.map(r=>[key(r.station_id),r])),byThreshold=new Map(thresholds.map(r=>[key(r.station_id),r])),byLink=new Map(links.map(r=>[key(r.station_id),r])),byHistory=group(history,'station_id'),byRain=group(rain,'aws_station_code'),byForecast=group(forecasts,'aws_station_code');const {time,num}=require('./risk-engine');
 return stations.map(station=>{const id=key(station.station_id),reading=byLatest.get(id),threshold=byThreshold.get(id),link=byLink.get(id),at=time(reading?.observed_at);const past=(byHistory.get(id)||[]).filter(r=>time(r.observed_at)>=at-7*3600000&&time(r.observed_at)<at);return {...station,...evaluate({station,latest:reading,threshold,history:past,historyStats:null,rain:(byRain.get(key(link?.aws_station_code))||[]).slice(0,12),forecast:(byForecast.get(key(link?.aws_station_code))||[]).slice(0,72),now}),water_level:num(reading?.water_level),water_observed_at:reading?.observed_at||null,observation_source_url:reading?.source_url||null,rainfall_link:link||null};});
}
module.exports={bulkAssess,group};
