'use strict';
require('dotenv').config();const fs=require('fs'),path=require('path');
const {configuredKey}=require('./hrfco-fetch-history'),{parseKoreanTimestamp}=require('./hrfco-warning-history');
const DOC='https://www.hrfco.go.kr/web/openapiPage/reference.do';let nextRequest=0;
async function setup(db){await db.query(`CREATE TABLE IF NOT EXISTS hr_rainfall_history(station_code VARCHAR(20) NOT NULL,observed_at DATETIME NOT NULL,rainfall_mm DECIMAL(10,3) NOT NULL,source_url VARCHAR(1000) NOT NULL,PRIMARY KEY(station_code,observed_at)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);await db.query(`CREATE TABLE IF NOT EXISTS hr_rainfall_links(station_id INT NOT NULL PRIMARY KEY,rainfall_station_code VARCHAR(20) NOT NULL,gauge_name VARCHAR(255) NOT NULL,latitude DECIMAL(10,6) NOT NULL,longitude DECIMAL(10,6) NOT NULL,distance_km DECIMAL(8,3) NOT NULL,source_url VARCHAR(1000) NOT NULL,verified_at DATETIME NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);}
async function fetchRain(code,start,end){
 const token=configuredKey(process.env.HRFCO_SERVICE_KEY);if(!/^[0-9A-Za-z-]{20,120}$/.test(token)||!/^\d{5,12}$/.test(code))throw Error('INVALID_HRFCO_CONFIGURATION');const slot=Math.max(Date.now(),nextRequest);nextRequest=slot+1000;if(slot>Date.now())await new Promise(r=>setTimeout(r,slot-Date.now()));
 const today=new Date(Date.now()+9*3600000).toISOString().replace(/[-:T]/g,'').slice(0,10),until=end===today.slice(0,8)?today:end+'23';
 const r=await fetch(`https://api.hrfco.go.kr/${encodeURIComponent(token)}/rainfall/list/1H/${code}/${start}00/${until}.json`,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HRFCO_RAIN_HTTP_'+r.status);const d=await r.json();if(!Array.isArray(d.content))throw Error('HRFCO_RAIN_SOURCE_UNAVAILABLE');return d.content.map(raw=>{if(String(raw.rfobscd)!==code)throw Error('RAINFALL_STATION_MISMATCH');const stamp=String(raw.ymdhm||''),at=parseKoreanTimestamp(stamp.length===10?stamp+'00':stamp),v=raw.rf==null||String(raw.rf).trim()===''?null:Number(raw.rf);return at&&v!==null&&Number.isFinite(v)&&v>=0?{at,value:v}:null;}).filter(Boolean);
}
async function saveRain(db,code,rows){let saved=0;for(let i=0;i<rows.length;i+=250){const batch=rows.slice(i,i+250);const [r]=await db.query(`INSERT IGNORE INTO hr_rainfall_history(station_code,observed_at,rainfall_mm,source_url) VALUES ${batch.map(()=>'(?,?,?,?)').join(',')}`,batch.flatMap(r=>[code,r.at,r.value,DOC+'#rainfall']));saved+=r.affectedRows;}return saved;}
async function enrich(db=require('./db'),options={}){
 await setup(db);const review=JSON.parse(fs.readFileSync(path.join(__dirname,'reports',options.reviewFile||'official-warning-archive-review.json'),'utf8'));if(review.status!=='RECONCILED')throw Error('WARNING_ARCHIVE_NOT_RECONCILED');
 const token=configuredKey(process.env.HRFCO_SERVICE_KEY);const response=await fetch(`https://api.hrfco.go.kr/${encodeURIComponent(token)}/rainfall/info.json`,{signal:AbortSignal.timeout(20000)});const body=await response.json();if(!Array.isArray(body.content))throw Error('RAIN_METADATA_UNAVAILABLE');
 const {parseCoord}=require('./wamis-client'),{haversine,located}=require('./geo');const gauges=body.content.map(g=>({...g,latitude:parseCoord(g.lat,'lat'),longitude:parseCoord(g.lon,'lon')})).filter(located);
 const [stations]=await db.query("SELECT * FROM stations WHERE data_source='RIVER_GAUGE'");const file=path.join(__dirname,'reports',options.reportFile||'warning-feature-history.json');let report={started_at:new Date().toISOString(),requests:[],stations:[]};try{report=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 delete report.completed_at;const save=()=>{report.updated_at=new Date().toISOString();report.inserted_water=report.requests.reduce((n,r)=>n+(r.inserted_water||0),0);report.inserted_rain=report.requests.reduce((n,r)=>n+(r.inserted_rain||0),0);fs.writeFileSync(file,JSON.stringify(report,null,2));};
 for(const coverage of review.coverage){const station=stations.find(s=>String(s.external_station_id)===coverage.station_code);if(!station)continue;const closest=gauges.map(g=>({...g,distance:haversine(station,g)})).filter(g=>g.distance<=30).sort((a,b)=>a.distance-b.distance)[0];if(!closest){report.stations.push({station_code:coverage.station_code,status:'NO_RAIN_GAUGE_WITHIN_30KM'});continue;}
  await db.execute("INSERT INTO hr_rainfall_links(station_id,rainfall_station_code,gauge_name,latitude,longitude,distance_km,source_url,verified_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE rainfall_station_code=VALUES(rainfall_station_code),gauge_name=VALUES(gauge_name),latitude=VALUES(latitude),longitude=VALUES(longitude),distance_km=VALUES(distance_km),source_url=VALUES(source_url),verified_at=VALUES(verified_at)",[station.station_id,String(closest.rfobscd),closest.obsnm,closest.latitude,closest.longitude,closest.distance,DOC+'#rainfall']);
  const start=new Date(Date.parse(coverage.start_at.replace(' ','T')+'+09:00')-73*3600000+9*3600000).toISOString().slice(0,10),end=coverage.end_at.slice(0,10);
  for(const [from,to] of require('./history-backfill').chunks(start,end,options.chunkDays||90)){
   const key=[station.station_id,closest.rfobscd,from,to].join(':');if(report.requests.some(r=>r.status==='IMPORTED'&&r.station_id===station.station_id&&r.rain_gauge===String(closest.rfobscd)&&r.from<=from&&r.to>=to))continue;const result={key,station_id:station.station_id,station_code:coverage.station_code,rain_gauge:String(closest.rfobscd),from,to};
   try{const water=await require('./hrfco-water-history').fetchHourlyHistory(coverage.station_code,from.replaceAll('-',''),to.replaceAll('-',''));if(!water.records.length)throw Error('EMPTY_WATER_HISTORY');let inserted=0;for(let i=0;i<water.records.length;i+=250){const batch=water.records.slice(i,i+250);const [r]=await db.query(`INSERT IGNORE INTO water_readings(station_id,observed_at,water_level,source_url) VALUES ${batch.map(()=>'(?,?,?,?)').join(',')}`,batch.flatMap(r=>[station.station_id,r.observedAt,r.waterLevel,water.source_url]));inserted+=r.affectedRows;}Object.assign(result,{received_water:water.records.length,inserted_water:inserted});const rain=await fetchRain(String(closest.rfobscd),from.replaceAll('-',''),to.replaceAll('-',''));if(!rain.length)throw Error('EMPTY_RAIN_HISTORY');const rainInserted=await saveRain(db,String(closest.rfobscd),rain);Object.assign(result,{status:'IMPORTED',received_water:water.records.length,received_rain:rain.length,inserted_water:inserted,inserted_rain:rainInserted,distance_km:closest.distance,source_url:DOC});}catch(e){Object.assign(result,{status:'UNAVAILABLE',reason:e.code||(/^[A-Z][A-Z0-9_]+$/.test(e.message||'')?e.message:e.name)});}
   const old=report.requests.findIndex(r=>r.key===key);if(old>=0)report.requests[old]=result;else report.requests.push(result);save();console.log(JSON.stringify({station:coverage.station_code,status:result.status,requests:report.requests.length,water:report.inserted_water,rain:report.inserted_rain}));
  }
 }
 report.completed_at=new Date().toISOString();save();return report;
}
async function recentRain(db,stationId,waterAt,windowHours=30){let link;try{const [[r]]=await db.execute('SELECT * FROM hr_rainfall_links WHERE station_id=? AND distance_km<=30',[stationId]);link=r;}catch(e){if(e.code==='ER_NO_SUCH_TABLE')return null;throw e;}if(!link)return null;const [rows]=await db.execute('SELECT observed_at,rainfall_mm AS hourly_rainfall FROM hr_rainfall_history WHERE station_code=? AND observed_at>=DATE_SUB(?,INTERVAL ? HOUR) AND observed_at<=? ORDER BY observed_at',[link.rainfall_station_code,waterAt,Math.max(30,Math.min(96,Number(windowHours)||30)),waterAt]);return {link,rows};}
async function refreshLatestRain(db=require('./db')){let codes;try{const [links]=await db.query('SELECT DISTINCT rainfall_station_code FROM hr_rainfall_links');codes=new Set(links.map(r=>String(r.rainfall_station_code)));}catch(e){if(e.code==='ER_NO_SUCH_TABLE')return;throw e;}if(!codes.size)return;const token=configuredKey(process.env.HRFCO_SERVICE_KEY);const r=await fetch(`https://api.hrfco.go.kr/${encodeURIComponent(token)}/rainfall/list/1H.json`,{signal:AbortSignal.timeout(15000)});const d=await r.json();if(!Array.isArray(d.content))throw Error('LIVE_RAIN_UNAVAILABLE');let saved=0;for(const raw of d.content){const code=String(raw.rfobscd),stamp=String(raw.ymdhm),at=parseKoreanTimestamp(stamp.length===10?stamp+'00':stamp),value=raw.rf==null||String(raw.rf).trim()===''?null:Number(raw.rf);if(codes.has(code)&&at&&value!==null&&Number.isFinite(value)&&value>=0)saved+=await saveRain(db,code,[{at,value}]);}return {updated:saved,gauges:codes.size};}

let rainMetadata,metadataAt=0;const repairPending=new Map(),repairAt=new Map();
async function ensureRecentRain(db,stationId,waterAt,{hours=24}={}){
 hours=Math.max(24,Math.min(72,Number(hours)||24));const repairKey=String(stationId)+':'+hours;
 if(repairPending.has(repairKey))return repairPending.get(repairKey);
 if(Date.now()-(repairAt.get(repairKey)||0)<5*60000)return;
 const task=(async()=>{
  if(!configuredKey(process.env.HRFCO_SERVICE_KEY))return;
  await setup(db);
  let [[link]]=await db.execute('SELECT * FROM hr_rainfall_links WHERE station_id=?',[stationId]);
  if(!link){
   const [[station]]=await db.execute("SELECT * FROM stations WHERE station_id=? AND data_source='RIVER_GAUGE'",[stationId]);if(!station)return;
   if(!rainMetadata||Date.now()-metadataAt>3600000){
    const token=configuredKey(process.env.HRFCO_SERVICE_KEY),r=await fetch(`https://api.hrfco.go.kr/${encodeURIComponent(token)}/rainfall/info.json`,{signal:AbortSignal.timeout(12000)}),body=await r.json();
    if(!Array.isArray(body.content))throw Error('RAIN_METADATA_UNAVAILABLE');
    const {parseCoord}=require('./wamis-client'),{located}=require('./geo');rainMetadata=body.content.map(g=>({...g,latitude:parseCoord(g.lat,'lat'),longitude:parseCoord(g.lon,'lon')})).filter(located);metadataAt=Date.now();
   }
   const {haversine,located}=require('./geo');if(!located(station))return;
   const gauge=rainMetadata.map(g=>({...g,distance:haversine(station,g)})).filter(g=>g.distance<=30).sort((a,b)=>a.distance-b.distance)[0];if(!gauge)return;
   await db.execute('INSERT IGNORE INTO hr_rainfall_links(station_id,rainfall_station_code,gauge_name,latitude,longitude,distance_km,source_url,verified_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP())',[stationId,String(gauge.rfobscd),gauge.obsnm,gauge.latitude,gauge.longitude,gauge.distance,DOC+'#rainfall']);
   [[link]]=await db.execute('SELECT * FROM hr_rainfall_links WHERE station_id=?',[stationId]);
  }
  const recent=await recentRain(db,stationId,waterAt,hours+6),{millis}=require('./monitoring-store'),end=millis(waterAt),hour=Math.floor(end/3600000)*3600000;
  const valid=new Set((recent?.rows||[]).filter(r=>r.hourly_rainfall!==null&&Number(r.hourly_rainfall)>=0).map(r=>millis(r.observed_at)));
  if(Array.from({length:hours},(_,i)=>hour-i*3600000).every(t=>valid.has(t))){repairAt.set(repairKey,Date.now());return;}
  const day=t=>new Date(t+9*3600000).toISOString().slice(0,10).replaceAll('-','');
  const rows=await fetchRain(String(link.rainfall_station_code),day(hour-(hours+6)*3600000),day(hour));
  await saveRain(db,String(link.rainfall_station_code),rows);repairAt.set(repairKey,Date.now());
 })().finally(()=>repairPending.delete(repairKey));repairPending.set(repairKey,task);return task;
}

if(require.main===module){const db=require('./db');enrich(db).then(r=>console.log(JSON.stringify({requests:r.requests.length,water:r.inserted_water,rain:r.inserted_rain}))).catch(e=>{console.error(e.code||e.name);process.exitCode=1;}).finally(()=>db.end());}
module.exports={ensureRecentRain,setup,enrich,recentRain,refreshLatestRain,fetchRain};
