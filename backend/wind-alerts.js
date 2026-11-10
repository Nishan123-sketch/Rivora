const {englishStationName}=require('./display-names');
const {fresh}=require('./monitoring-store');

// A warning describes an area; a station observation is separate supporting context.
function attachWindObservations(official,observations,now=Date.now()){
 return {...official,data:(official.data||[]).map(alert=>{
  if(!['W','T'].includes(alert.type))return alert;
  const area=String(alert.area||'').replace(/\s+/g,'');
  const matches=observations.filter(row=>{
   const name=String(row.station_name||'').replace(/\s+/g,'').replace(/[시군]$/u,'');
   return name.length>=2&&area.includes(name)&&row.wind_speed!==null&&row.wind_speed!==undefined&&row.wind_speed!==''&&Number.isFinite(Number(row.wind_speed))&&Number(row.wind_speed)>=0&&fresh(row.observed_at,now);
  }).sort((a,b)=>Number(b.wind_speed)-Number(a.wind_speed)).slice(0,3);
  return {...alert,wind_observations:matches.map(row=>({station_id:row.station_id,station_name:englishStationName(row.station_name),speed_ms:Number(row.wind_speed),speed_kmh:Math.round(Number(row.wind_speed)*36)/10,observed_at:row.observed_at})),wind_status:matches.length?'AVAILABLE':'NO_RECENT_MATCHED_STATION'};
 })};
}
async function enrichWindAlerts(official,db=require('./db')){
 if(!(official.data||[]).some(a=>['W','T'].includes(a.type)))return official;
 const [rows]=await db.query(`SELECT s.station_id,s.station_name,w.wind_speed,w.observed_at
 FROM stations s JOIN weather_readings w ON w.station_id=s.station_id
 JOIN (SELECT station_id,MAX(observed_at) observed_at FROM weather_readings
 WHERE wind_speed IS NOT NULL AND wind_speed>=0
 AND observed_at BETWEEN UTC_TIMESTAMP()+INTERVAL 9 HOUR-INTERVAL 3 HOUR AND UTC_TIMESTAMP()+INTERVAL 9 HOUR
 GROUP BY station_id) latest ON latest.station_id=w.station_id AND latest.observed_at=w.observed_at
 WHERE s.data_source='KMA'`);
 return attachWindObservations(official,rows);
}
module.exports={attachWindObservations,enrichWindAlerts};
