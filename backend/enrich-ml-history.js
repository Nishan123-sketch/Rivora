'use strict';
// Authentic, resumable WAMIS enrichment. Existing measurements are never overwritten.
require('dotenv').config();const fs=require('fs'),path=require('path');
async function enrich({db=require('./db'),start='20260801',end=new Date(Date.now()+9*3600000).toISOString().slice(0,10).replaceAll('-',''),getWamis=require('./wamis-client').getWamisForHistory,baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'reports/advanced-level-network.json'),'utf8')),reportFile=path.join(__dirname,'reports/ml-history-enrichment.json')}={}){
 const file=reportFile;let report={started_at:new Date().toISOString(),start,end,baseline_available:baseline.available,stations:[]};
 try{const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.start===start&&old.end===end)report=old;}catch{}
 delete report.stopped_reason;delete report.completed_at;
 report.targets||=[...new Map([...report.stations,...baseline.stations.filter(s=>['INSUFFICIENT_HISTORICAL_HOURLY_LEVELS','TOO_FEW_CONSECUTIVE_HISTORICAL_WINDOWS','INSUFFICIENT_CHRONOLOGICAL_SPLIT'].includes(s.reason))].map(s=>[s.station_id,{station_id:s.station_id,station_code:s.station_code}])).values()];
 // Always try unattempted stations before revisiting failed source requests.
 // Otherwise a few persistently unavailable gauges could block the whole queue.
 const candidates=[...report.targets].sort((a,b)=>Number(report.stations.some(r=>r.station_id===a.station_id))-Number(report.stations.some(r=>r.station_id===b.station_id)));
 report.candidates=candidates.length;let consecutiveFailures=0;
 const save=()=>{report.updated_at=new Date().toISOString();report.inserted_rows=report.stations.reduce((n,s)=>n+(s.inserted||0),0);fs.writeFileSync(file,JSON.stringify(report,null,2));};
 let next=0,stopped=false;
 async function worker(){while(next<candidates.length&&!stopped){const s=candidates[next++];if(report.stations.some(r=>r.station_id===s.station_id&&r.status==='IMPORTED'))continue;
  const result={station_id:s.station_id,station_code:s.station_code};
  try{if(!/^\d{5,12}$/.test(String(s.station_code)))throw Error('INVALID_OFFICIAL_CODE');
   let official=null,raw,actualStart=start;
   if(getWamis===require('./wamis-client').getWamisForHistory&&process.env.HRFCO_SERVICE_KEY){try{official=await require('./hrfco-water-history').fetchHourlyHistory(s.station_code,start,end);}catch{/* The other official provider remains available as fallback. */}}
   if(!official){actualStart=new Date(Date.parse(end.slice(0,4)+'-'+end.slice(4,6)+'-'+end.slice(6,8)) - 38*86400000).toISOString().slice(0,10).replaceAll('-','');
    try{raw=await getWamis('wl_hrdata',{obscd:s.station_code,startdt:actualStart,enddt:end},6000);}
    catch{actualStart=start;raw=await getWamis('wl_hrdata',{obscd:s.station_code,startdt:actualStart,enddt:end},6000);}}
   const rows=(official?official.records:require('./wamis-client').mapReadings(raw)).filter(r=>r.observedAt>=`${start.slice(0,4)}-${start.slice(4,6)}-${start.slice(6,8)} 00:00:00`&&require('./risk-engine').time(r.observedAt)<=Date.now());
   if(!rows.length)throw Error('NO_USABLE_OFFICIAL_HISTORY');
   let inserted=0;const url=official?.source_url||`http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_hrdata?obscd=${s.station_code}&startdt=${actualStart}&enddt=${end}&output=json`;
   for(let i=0;i<rows.length;i+=250){const batch=rows.slice(i,i+250);const [r]=await db.query(`INSERT IGNORE INTO water_readings(station_id,observed_at,water_level,source_url) VALUES ${batch.map(()=>'(?,?,?,?)').join(',')}`,batch.flatMap(r=>[s.station_id,r.observedAt,r.waterLevel,url]));inserted+=r.affectedRows;}
   Object.assign(result,{provider:official?'HRFCO_WATERLEVEL_1H':'WAMIS_HOURLY',request_template:official?.request_template||null,requested_start:official?.start||actualStart,requested_end:official?.end||end,status:'IMPORTED',received:rows.length,inserted,first:rows[0].observedAt,last:rows.at(-1).observedAt,source_url:url});consecutiveFailures=0;
  }catch(e){Object.assign(result,{status:'UNAVAILABLE',reason:e.code||e.name||'SOURCE_UNAVAILABLE'});consecutiveFailures++;}
  const previous=report.stations.findIndex(r=>r.station_id===s.station_id);if(previous>=0)report.stations[previous]=result;else report.stations.push(result);save();
  if(report.stations.length%10===0||result.status!=='IMPORTED')console.log(JSON.stringify({processed:report.stations.length,total:candidates.length,inserted_rows:report.inserted_rows,last_status:result.status}));
  if(consecutiveFailures>=3){report.stopped_reason='CONSECUTIVE_SOURCE_FAILURES';stopped=true;save();break;}
 }}
 await Promise.all([worker(),worker()]);
 report.completed_at=new Date().toISOString();save();return report;
}
async function runEnrichment(db=require('./db')){
 const lock=path.join(__dirname,'reports/.ml-history-enrichment.lock');
 if(fs.existsSync(lock)){try{process.kill(Number(fs.readFileSync(lock,'utf8')),0);return {status:'ENRICHMENT_ALREADY_RUNNING'};}catch(e){if(e.code!=='ESRCH')return {status:'ENRICHMENT_LOCK_UNAVAILABLE'};}fs.unlinkSync(lock);}
 try{fs.writeFileSync(lock,String(process.pid),{flag:'wx'});}catch{return {status:'ENRICHMENT_ALREADY_RUNNING'};}
 try{const r=await enrich({db});const evaluation=await require('./ml-refresh-network').refresh(db);return {processed:r.stations.length,inserted:r.inserted_rows,stopped_reason:r.stopped_reason||null,forecast_ready:evaluation.available??null};}finally{fs.unlinkSync(lock);}
}
if(require.main===module){const db=require('./db');runEnrichment(db).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.code||e.name);process.exitCode=1;}).finally(()=>db.end());}
module.exports={enrich};
