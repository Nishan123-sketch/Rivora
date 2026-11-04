const pool = require('./db');
const number = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const millis = v => new Date(String(v || '').replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(String(v)) ? '' : '+09:00')).getTime();
const fresh = (time, now = Date.now()) => Number.isFinite(millis(time)) && now - millis(time) >= 0 && now - millis(time) <= 3 * 3600000;
function stage(level, threshold) {
 const values = ['interest_level_m','caution_level_m','alert_level_m','severe_level_m'].map(k=>number(threshold?.[k]));
 if (number(level) === null || threshold?.verification_status !== 'VERIFIED' || !threshold?.source_url || !threshold?.verified_at || values.some(v=>v===null) || !values.every((v,i)=>!i||v>values[i-1])) return null;
 return level >= values[2] ? 'High' : level >= values[1] ? 'Moderate' : 'Low';
}
async function summaries(db = pool) {
 const [stations] = await db.query('SELECT * FROM stations ORDER BY station_name');
 const [water] = await db.query(`SELECT w.* FROM water_readings w JOIN (SELECT station_id,MAX(observed_at) AS observed_at FROM water_readings GROUP BY station_id) m ON m.station_id=w.station_id AND m.observed_at=w.observed_at`);
 const [weather] = await db.query(`SELECT w.* FROM weather_readings w JOIN (SELECT station_id,MAX(observed_at) AS observed_at FROM weather_readings GROUP BY station_id) m ON m.station_id=w.station_id AND m.observed_at=w.observed_at`);
 const [aws] = await db.query(`SELECT a.* FROM aws_rainfall_readings a JOIN (SELECT aws_station_code,MAX(observed_at) AS observed_at FROM aws_rainfall_readings GROUP BY aws_station_code) m ON m.aws_station_code=a.aws_station_code AND m.observed_at=a.observed_at`);
 const [rainHistory]=await db.query('SELECT * FROM aws_rainfall_readings WHERE observed_at>=UTC_TIMESTAMP()+INTERVAL 9 HOUR-INTERVAL 15 HOUR ORDER BY observed_at');
 const [thresholds] = await db.query('SELECT * FROM flood_thresholds');
 const [links] = await db.query("SELECT * FROM station_rainfall_links WHERE verification_status='VERIFIED'");
 const [predictions] = await db.query(`SELECT p.* FROM prediction_history p JOIN (SELECT station_id,MAX(observed_at) AS observed_at FROM prediction_history GROUP BY station_id) m ON m.station_id=p.station_id AND m.observed_at=p.observed_at ORDER BY p.station_id,(p.status='ML_STAGE') DESC,p.prediction_id DESC`);
 const byStation=rows=>{const m=new Map();for(const r of rows){const k=String(r.station_id);if(!m.has(k))m.set(k,r)}return m};
 const waterBy=byStation(water),weatherBy=byStation(weather),linkBy=byStation(links),thresholdBy=byStation(thresholds),predictionBy=byStation(predictions);
 const awsBy=new Map();for(const a of aws){const k=String(a.aws_station_code);if(!awsBy.has(k))awsBy.set(k,a)}
 // Group the 15-hour rain history by AWS code ONCE (was: filter of the whole history for every station)
 const rainBy=new Map();for(const x of rainHistory){const k=String(x.aws_station_code);let e=rainBy.get(k);if(!e){e={rows:[],byTime:new Map()};rainBy.set(k,e)}e.rows.push(x);const t=millis(x.observed_at);if(!e.byTime.has(t))e.byTime.set(t,x)}
 const compareRainfall=require('./rainfall-reference').compareRainfall;
 return stations.map(s=>{
  const w=waterBy.get(String(s.station_id));
  const weatherRow=weatherBy.get(String(s.station_id));
  const link=linkBy.get(String(s.station_id));
  const code=s.data_source==='KMA'?s.external_station_id:link?.aws_station_code;
  const rain=awsBy.get(String(code));
  const rainEntry=rainBy.get(String(code));const rainRows=rainEntry?rainEntry.rows:[];
  const periods=[3,12].map(hours=>{const last=rainRows.at(-1);const end=millis(last?.observed_at);const values=Array.from({length:hours},(_,i)=>rainEntry?.byTime.get(end-i*3600000));const complete=fresh(last?.observed_at)&&values.every(x=>number(x?.hourly_rainfall)!==null&&number(x?.hourly_rainfall)>=0);return {hours,status:complete?'COMPLETE':'INCOMPLETE',rainfall_mm:complete?values.reduce((n,x)=>n+number(x.hourly_rainfall),0):null};});
  const rainfallComparison=compareRainfall(periods);
  const t=thresholdBy.get(String(s.station_id));
  const prediction=predictionBy.get(String(s.station_id));
  const currentPrediction=prediction&&fresh(prediction.observed_at)&&millis(prediction.valid_at)>Date.now()?prediction:null;
  const waterCurrent=w&&fresh(w.observed_at);
  const rainRisk=rainfallComparison.status==='WARNING_CRITERION_MET'?'High':rainfallComparison.status==='ADVISORY_CRITERION_MET'?'Moderate':rainfallComparison.status==='BELOW_REFERENCE_CRITERIA'?'Low':null;
  const risk=s.data_source==='KMA'?rainRisk:currentPrediction?.risk_level || (waterCurrent?stage(number(w.water_level),t):null);
  return {...s,water_level:number(w?.water_level),water_observed_at:w?.observed_at||null,
   rainfall:number(rain?.hourly_rainfall)??number(weatherRow?.hourly_rainfall),
   reported_rainfall:number(weatherRow?.rainfall),temperature:number(weatherRow?.temperature),
   rainfall_observed_at:rain?.observed_at||weatherRow?.observed_at||null,rainfall_station_code:code||null,
   rainfall_source:rain?'KMA AWS hourly':weatherRow?'KMA observation':null,
   risk_level:risk,risk_score:number(currentPrediction?.risk_score),prediction:currentPrediction,
   threshold_verification:waterCurrent&&stage(number(w.water_level),t)&&rainfallComparison.coverage==='COMPLETE'?'Verified':'Not Verified',
   water_threshold_verification:waterCurrent&&stage(number(w.water_level),t)?'Verified':'Not Verified',
   rainfall_threshold_verification:rainfallComparison.coverage==='COMPLETE'?'Verified':'Not Verified',
   rainfall_comparison:rainfallComparison,thresholds:t||null,data_status:waterCurrent||fresh(rain?.observed_at)||fresh(weatherRow?.observed_at)?'Fresh':w||rain||weatherRow?'Stale data':'No station data'};
 });
}
function dateRange(query) {
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const start=query.start||new Date(Date.now()+9*3600000-7*86400000).toISOString().slice(0,10),end=query.end||today;
 for(const value of [start,end]) if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value).toISOString().slice(0,10)!==value)throw Error('Use valid YYYY-MM-DD dates');
 if(start>end || (Date.parse(end)-Date.parse(start))/86400000>366)throw Error('Choose an ordered range of at most 366 days');
 return [start+' 00:00:00',end+' 23:59:59'];
}
async function history(id, query, db=pool) {
 const [start,end]=dateRange(query);
 const filter=id==='all'?'': ' AND station_id=?';
 const params=id==='all'?[start,end]:[start,end,id];
 const [water]=await db.execute(`SELECT station_id,observed_at,water_level,flow_rate FROM water_readings WHERE observed_at BETWEEN ? AND ?${filter} ORDER BY observed_at LIMIT 20001`,params);
 const [weather]=await db.execute(`SELECT station_id,observed_at,temperature,hourly_rainfall,rainfall FROM weather_readings WHERE observed_at BETWEEN ? AND ?${filter} ORDER BY observed_at LIMIT 20001`,params);
 const [predictions]=await db.execute(`SELECT * FROM prediction_history WHERE observed_at BETWEEN ? AND ?${filter} ORDER BY observed_at LIMIT 20001`,params);
 const [risks]=await db.execute(`SELECT station_id,assessed_at,risk_level,risk_score,reason FROM risk_assessments WHERE assessed_at BETWEEN ? AND ?${filter} ORDER BY assessed_at LIMIT 20001`,params);
 const sf=id==='all'?'':' AND s.station_id=?';
 // UNION (de-duplicating) of the two mapping paths; the old "JOIN ... ON a OR EXISTS(...)" could not use an index.
 const [rainfall]=await db.execute(`(SELECT s.station_id,a.observed_at,a.hourly_rainfall FROM stations s JOIN aws_rainfall_readings a ON a.aws_station_code=s.external_station_id WHERE s.data_source='KMA' AND a.observed_at BETWEEN ? AND ?${sf}) UNION (SELECT l.station_id,a.observed_at,a.hourly_rainfall FROM station_rainfall_links l JOIN stations s ON s.station_id=l.station_id JOIN aws_rainfall_readings a ON a.aws_station_code=l.aws_station_code WHERE l.verification_status='VERIFIED' AND a.observed_at BETWEEN ? AND ?${sf}) ORDER BY observed_at LIMIT 20001`,[...params,...params]);
 const truncated=[water,weather,predictions,risks,rainfall].some(a=>a.length>20000);
 return {success:true,start,end,water:water.slice(0,20000),weather:weather.slice(0,20000),predictions:predictions.slice(0,20000),risks:risks.slice(0,20000),rainfall:rainfall.slice(0,20000),truncated};
}
module.exports={number,millis,fresh,stage,summaries,dateRange,history};
