'use strict';
const {resolvePlaces}=require('./place-resolver');
const specs={search_places:{query:{type:'string'}},get_station_status:{id:{type:'integer'}},get_risk:{id:{type:'integer'}},get_weather:{place:{type:'string'}},get_forecast:{place:{type:'string'}},get_history_summary:{id:{type:'integer'},range:{type:'integer',minimum:1,maximum:366}},system_overview:{}};
const tools=Object.entries(specs).map(([name,properties])=>({name,description:{search_places:'Resolve a city or river gauge; low confidence requires user clarification.',get_station_status:'Read current station observations with time and source.',get_risk:'Read the same unified risk assessment used by the dashboard.',get_weather:'Read stored weather for a place, or sourced Open-Meteo current weather.',get_forecast:'Read sourced Open-Meteo hourly weather forecast for a place.',get_history_summary:'Summarize stored daily history for a station over range days.',system_overview:'Count monitored river gauges and list rising gauges using the unified engine.'}[name],input_schema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}));
function createExecutor({db=require('./db'),fetcher=fetch,getUnified=require('./risk-engine').getUnified}={}){
 async function execute(name,input={}){
  const spec=specs[name];if(!spec)throw Error('Unknown tool');
  for(const [key,type] of Object.entries(spec)){const v=input[key];if(type.type==='integer'&&(!Number.isSafeInteger(v)||v<1||v>(type.maximum||Number.MAX_SAFE_INTEGER)))throw Error('Invalid '+key);if(type.type==='string'&&(typeof v!=='string'||!v.trim()||v.length>200))throw Error('Invalid '+key);}
  if(Object.keys(input).some(k=>!Object.hasOwn(spec,k)))throw Error('Unknown tool argument');
  const envelope=data=>({retrieved_at:new Date().toISOString(),timezone:'Asia/Seoul',data});
  if(name==='get_risk')return envelope((await getUnified()).find(r=>Number(r.station_id)===input.id)||{status:'NOT_FOUND'});
  if(name==='system_overview'){const rows=await getUnified();return envelope({monitored_gauges:rows.length,assessable:rows.filter(r=>r.level).length,rising:rows.filter(r=>r.observation_freshness==='FRESH'&&r.rise_1h>0).map(r=>({station_id:r.station_id,station_name:r.station_name,rise_1h:r.rise_1h,observed_at:r.observed_at})),assessments:rows.map(r=>({station_id:r.station_id,level:r.level,basis:r.basis}))});}
  if(name==='search_places'){const [stations]=await db.execute('SELECT station_id,station_name,external_station_id,data_source FROM stations');const visible=await require('./official-station-policy').publicStations(stations);const candidates=resolvePlaces(input.query,visible);return envelope({candidates,needs_clarification:!candidates.length||candidates[0].confidence<0.8||(candidates[1]?.confidence>=candidates[0].confidence-0.05)});}
  if(name==='get_station_status'){const {buildContext}=require('./chat-context');return buildContext('current observations',input.id,[],db);}
  if(name==='get_history_summary'){const [rows]=await db.execute('SELECT MIN(day) AS first_day,MAX(day) AS last_day,MIN(min_level) AS min_level,MAX(max_level) AS max_level,AVG(mean_level) AS mean_daily_level,SUM(samples) AS samples FROM water_daily WHERE station_id=? AND day>=DATE_SUB(UTC_DATE(),INTERVAL ? DAY)',[input.id,input.range]);return envelope(rows[0]);}
  const [stations]=await db.execute("SELECT station_id,station_name,external_station_id,data_source FROM stations WHERE data_source='KMA'");const candidates=resolvePlaces(input.place,stations);
  const matched=candidates[0]?.confidence>=0.75&&(!candidates[1]||candidates[0].confidence-candidates[1].confidence>0.05);
  if(matched){
   if(name==='get_weather'){const [rows]=await db.execute('SELECT observed_at,temperature,hourly_rainfall,humidity,wind_speed FROM weather_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 1',[candidates[0].station_id]);return envelope({place:candidates[0],provider:'KMA',observations:rows});}
   const [rows]=await db.execute('SELECT issued_at,valid_at,rainfall_forecast,temperature_forecast,precipitation_probability,source FROM weather_forecasts WHERE station_id=? AND issued_at=(SELECT MAX(issued_at) FROM weather_forecasts WHERE station_id=?) AND valid_at>UTC_TIMESTAMP()+INTERVAL 9 HOUR ORDER BY valid_at LIMIT 72',[candidates[0].station_id,candidates[0].station_id]);
   if(rows.length)return envelope({place:candidates[0],provider:'KMA',forecasts:rows});
  }
  const place=/^ulsn$/i.test(input.place.trim())?'Ulsan':input.place;
  const geoUrl='https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:place,count:'3',language:'en',format:'json'});
  const geo=await fetcher(geoUrl,{signal:AbortSignal.timeout(8000)});if(!geo.ok)throw Error('Geocoder unavailable');const locations=(await geo.json()).results||[];
  if(locations.length!==1&&!(locations[0]?.country_code==='KR'&&locations.slice(1).every(l=>l.country_code!=='KR')))return envelope({needs_clarification:true,candidates:locations.map(l=>({name:l.name,country:l.country,admin1:l.admin1}))});
  const location=locations[0];if(!location)return envelope({status:'PLACE_NOT_FOUND'});
  const url='https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:location.latitude,longitude:location.longitude,current:'temperature_2m,precipitation,wind_speed_10m',hourly:'temperature_2m,precipitation,precipitation_probability',forecast_days:'3',timezone:'Asia/Seoul'});
  const response=await fetcher(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Weather provider unavailable');return envelope({place:location,provider:'Open-Meteo',source_url:url,weather:await response.json()});
 }
 return execute;
}
module.exports={tools,createExecutor};
