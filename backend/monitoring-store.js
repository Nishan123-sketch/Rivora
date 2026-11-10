const pool = require('./db');
const number = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const millis = v => new Date(String(v || '').replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(String(v)) ? '' : '+09:00')).getTime();
const fresh = (time, now = Date.now()) => Number.isFinite(millis(time)) && now - millis(time) >= 0 && now - millis(time) <= 3 * 3600000;
function stage(level, threshold) {
 const values = ['interest_level_m','caution_level_m','alert_level_m','severe_level_m'].map(k=>number(threshold?.[k]));
 if (number(level) === null || threshold?.verification_status !== 'VERIFIED' || !threshold?.source_url || !threshold?.verified_at || values.some(v=>v===null) || !values.every((v,i)=>!i||v>values[i-1])) return null;
 return level >= values[2] ? 'High' : level >= values[1] ? 'Moderate' : 'Low';
}
async function calculateSummaries(db = pool, {unified=db===pool} = {}) {
 const [stations] = await db.query('SELECT * FROM stations ORDER BY station_name');
 const [water] = await db.query(`
  SELECT w.*
  FROM water_readings w
  JOIN (
   SELECT station_id, MAX(observed_at) AS observed_at
   FROM water_readings
   GROUP BY station_id 
  ) latest
   ON latest.station_id = w.station_id
  AND latest.observed_at = w.observed_at`);
   const [weather] = await db.query(`
  SELECT w.*
  FROM weather_readings w
  JOIN (
   SELECT station_id, MAX(observed_at) AS observed_at
   FROM weather_readings
   GROUP BY station_id
  ) latest
   ON latest.station_id = w.station_id
  AND latest.observed_at = w.observed_at
 `);

 const [aws] = await db.query(`
  SELECT a.*
  FROM aws_rainfall_readings a
  JOIN (
   SELECT aws_station_code, MAX(observed_at) AS observed_at
   FROM aws_rainfall_readings
   GROUP BY aws_station_code
  ) latest
   ON latest.aws_station_code = a.aws_station_code
  AND latest.observed_at = a.observed_at
 `);
 const [rainHistory]=await db.query('SELECT * FROM aws_rainfall_readings WHERE observed_at>=UTC_TIMESTAMP()+INTERVAL 9 HOUR-INTERVAL 15 HOUR ORDER BY observed_at');
 const [thresholds] = await db.query('SELECT * FROM flood_thresholds');
 const [links] = await db.query("SELECT * FROM station_rainfall_links WHERE verification_status IN ('VERIFIED','AUTO_NEAREST')");
 const [predictions] = await db.query(`SELECT p.* FROM stations station JOIN prediction_history p ON p.prediction_id=(SELECT p2.prediction_id FROM prediction_history p2 WHERE p2.station_id=station.station_id ORDER BY p2.observed_at DESC,(p2.status='ML_STAGE') DESC,p2.prediction_id DESC LIMIT 1)`);
 const unifiedRows=unified?await require('./risk-engine').getUnified():[];
 return stations.map(s=>{
  const w=water.find(x=>String(x.station_id)===String(s.station_id));
  const weatherRow=weather.find(x=>String(x.station_id)===String(s.station_id));
  const link=links.find(x=>String(x.station_id)===String(s.station_id));
  const code=s.data_source==='KMA'?s.external_station_id:link?.aws_station_code;
  const rain=aws.find(x=>String(x.aws_station_code)===String(code));
  const rainRows=rainHistory.filter(x=>String(x.aws_station_code)===String(code));
  const periods=[3,12].map(hours=>{const last=rainRows.at(-1);const end=millis(last?.observed_at);const values=Array.from({length:hours},(_,i)=>rainRows.find(x=>millis(x.observed_at)===end-i*3600000));const complete=fresh(last?.observed_at)&&values.every(x=>number(x?.hourly_rainfall)!==null&&number(x?.hourly_rainfall)>=0);return {hours,status:complete?'COMPLETE':'INCOMPLETE',rainfall_mm:complete?values.reduce((n,x)=>n+number(x.hourly_rainfall),0):null};});
  const rainfallComparison=require('./rainfall-reference').compareRainfall(periods);
  const t=thresholds.find(x=>String(x.station_id)===String(s.station_id));
  const prediction=predictions.find(x=>String(x.station_id)===String(s.station_id));
  const currentPrediction=prediction&&fresh(prediction.observed_at)&&millis(prediction.valid_at)>Date.now()?prediction:null;
  const waterCurrent=w&&fresh(w.observed_at);
  const verifiedStageRisk=waterCurrent?stage(number(w.water_level),t):null;
  // Rainfall comparisons at KMA stations are not river flood assessments.
  // An evaluated model estimate remains explicitly experimental.
  const modelRisk=waterCurrent && ['Low','Moderate','High'].includes(currentPrediction?.risk_level)
    ? currentPrediction.risk_level : null;
  const riskBasis=s.data_source==='KMA' ? null
    : verifiedStageRisk ? 'VERIFIED_STAGE'
    : modelRisk ? 'EXPERIMENTAL_MODEL' : null;
  const risk=riskBasis==='VERIFIED_STAGE' ? verifiedStageRisk
    : riskBasis==='EXPERIMENTAL_MODEL' ? modelRisk : null;
  return {...s,water_level:number(w?.water_level),water_observed_at:w?.observed_at||null,
   rainfall:number(rain?.hourly_rainfall)??number(weatherRow?.hourly_rainfall),
   reported_rainfall:number(weatherRow?.rainfall),temperature:number(weatherRow?.temperature),
   rainfall_observed_at:rain?.observed_at||weatherRow?.observed_at||null,rainfall_station_code:code||null,
   rainfall_source:rain?'KMA AWS hourly':weatherRow?'KMA observation':null,
   risk_level:risk,risk_basis:riskBasis,risk_score:number(currentPrediction?.risk_score),prediction:currentPrediction,
   threshold_verification:verifiedStageRisk&&rainfallComparison.coverage==='COMPLETE'?'Verified':'Not Verified',
   water_threshold_verification:verifiedStageRisk?'Verified':'Not Verified',
   rainfall_threshold_verification:rainfallComparison.coverage==='COMPLETE'?'Verified':'Not Verified',
   rainfall_comparison:rainfallComparison,thresholds:t||null,data_status:waterCurrent||fresh(rain?.observed_at)||fresh(weatherRow?.observed_at)?'Fresh':w||rain||weatherRow?'Stale data':'No station data',
   ...(() => {const a=unifiedRows.find(r=>String(r.station_id)===String(s.station_id));return unified&&s.data_source==='RIVER_GAUGE'?{risk_level:a?.level||null,risk_score:a?.score??null,risk_basis:a?.basis||null,unified_risk:a||null}:{};})()};
 });
}
const pendingSummaries=new WeakMap();
const summaryCache=new WeakMap();
function summaries(db=pool,options){const cached=summaryCache.get(db);if(db===pool&&!options&&cached&&Date.now()-cached.at<30000)return Promise.resolve(cached.data);if(pendingSummaries.has(db))return pendingSummaries.get(db);const pending=calculateSummaries(db,options).then(data=>{if(db===pool&&!options)summaryCache.set(db,{at:Date.now(),data});return data;}).finally(()=>pendingSummaries.delete(db));pendingSummaries.set(db,pending);return pending;}
function dateRange(query) {
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const start=query.start||new Date(Date.now()+9*3600000-7*86400000).toISOString().slice(0,10),end=query.end||today;
 for(const value of [start,end]) if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value).toISOString().slice(0,10)!==value)throw Error('Use valid YYYY-MM-DD dates');
 if(start>end || (Date.parse(end)-Date.parse(start))/86400000>366)throw Error('Choose an ordered range of at most 366 days');
 return [start+' 00:00:00',end+' 23:59:59'];
}
async function history(id, query, db=pool) {
 const [start,end]=dateRange(query);
 if(id==='all'||Date.parse(end.slice(0,10))-Date.parse(start.slice(0,10))>31*86400000)return require('./history-daily').dailyHistory(id,start,end,db);
 const filter=id==='all'?'': ' AND station_id=?';
 const params=id==='all'?[start,end]:[start,end,id];
 const [water]=await db.execute(`SELECT station_id,observed_at,water_level,flow_rate FROM water_readings WHERE observed_at BETWEEN ? AND ?${filter} ORDER BY observed_at LIMIT 20001`,params);
 const [weather]=await db.execute(`SELECT station_id,observed_at,temperature,hourly_rainfall,rainfall FROM weather_readings WHERE observed_at BETWEEN ? AND ?${filter} ORDER BY observed_at LIMIT 20001`,params);
 const [predictions]=await db.execute(`SELECT * FROM prediction_history WHERE observed_at BETWEEN ? AND ?${filter} ORDER BY observed_at LIMIT 20001`,params);
 const [risks]=await db.execute(`SELECT station_id,assessed_at,risk_level,risk_score,reason FROM risk_assessments WHERE assessed_at BETWEEN ? AND ?${filter} ORDER BY assessed_at LIMIT 20001`,params);
 const [rainfall]=await db.execute(`SELECT DISTINCT s.station_id,a.observed_at,a.hourly_rainfall FROM aws_rainfall_readings a JOIN stations s ON (s.data_source='KMA' AND s.external_station_id=a.aws_station_code) OR EXISTS (SELECT 1 FROM station_rainfall_links l WHERE l.station_id=s.station_id AND l.aws_station_code=a.aws_station_code AND l.verification_status IN ('VERIFIED','AUTO_NEAREST')) WHERE a.observed_at BETWEEN ? AND ?${id==='all'?'':' AND s.station_id=?'} ORDER BY a.observed_at LIMIT 20001`,params);
 const truncated=[water,weather,predictions,risks,rainfall].some(a=>a.length>20000);
 return {success:true,start,end,water:water.slice(0,20000),weather:weather.slice(0,20000),predictions:predictions.slice(0,20000),risks:risks.slice(0,20000),rainfall:rainfall.slice(0,20000),truncated,granularity:'hourly',coverage:require('./history-daily').coverage(water,start,end)};
}
module.exports={number,millis,fresh,stage,summaries,dateRange,history};
