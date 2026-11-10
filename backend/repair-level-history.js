'use strict';
// Only derived, independently retrieved water history is written. Raw observations stay untouched.
require('dotenv').config();const fs=require('fs'),path=require('path'),crypto=require('crypto');
const DIR=path.join(__dirname,'reports/availability-repair');
const iso=d=>new Date(d).toISOString().slice(0,10);
function missingWindows(start,end,verifiedDays){const missing=[];for(let d=Date.parse(start);d<=Date.parse(end);d+=86400000){const day=iso(d);if(!verifiedDays.has(day))missing.push(day);}const windows=[];for(const day of missing){const last=windows.at(-1);if(last&&Date.parse(day)-Date.parse(last.to)===86400000&&last.days<90){last.to=day;last.days++;}else windows.push({from:day,to:day,days:1});}return windows;}
function safeError(e){return e.code||(/^[A-Z][A-Z0-9_]+$/.test(e.message||'')?e.message:e.name);}
async function repair({db=require('./db'),fetchHistory=require('./hrfco-water-history').fetchHourlyHistory,ids=null}={}){
 fs.mkdirSync(DIR,{recursive:true});await require('./level-history-provenance').setup(db);const file=path.join(DIR,'history-repair.json');let report={started_at:new Date().toISOString(),requests:[],stations:[]};try{report=JSON.parse(fs.readFileSync(file,'utf8'));}catch{};
 const training=JSON.parse(fs.readFileSync(path.join(__dirname,'reports/availability-repair/training-before.json'),'utf8'));const targets=training.stations.filter(s=>!s.eligible&&!['1022640','1018680','1021650','6003620','6001650','6002670'].includes(String(s.external_station_id))&&(!ids||ids.includes(Number(s.station_id))));report.targets=targets.map(s=>s.station_id);
 const save=()=>{report.updated_at=new Date().toISOString();report.inserted=report.requests.reduce((n,r)=>n+(r.inserted||0),0);const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(report,null,2));fs.renameSync(temp,file);};
 const end=iso(Date.now()+9*3600000),start=iso(Date.parse(end)-366*86400000);let failures=0;
 for(const target of targets){const id=Number(target.station_id),code=String(target.external_station_id);const [[identity]]=await db.execute("SELECT external_station_id FROM stations WHERE station_id=? AND data_source='RIVER_GAUGE'",[id]);if(String(identity?.external_station_id)!==code)throw Error('STATION_IDENTITY_CHANGED');
  // Do not re-fetch fully verified historical days. Missing hours remain real gaps.
  const [days]=await db.execute('SELECT DATE_FORMAT(observed_at,\'%Y-%m-%d\') day,COUNT(DISTINCT observed_at) n FROM ml_verified_water_history WHERE station_id=? AND observed_at>=? AND observed_at<=? GROUP BY day',[id,start,end+' 23:59:59']);const full=new Set(days.filter(d=>d.n>=24).map(d=>d.day));
  const windows=missingWindows(start,end,full);const state={station_id:id,station_code:code,windows_requested:0,already_verified_days:full.size};
  for(const w of windows){const key=[id,code,w.from,w.to].join(':');const previous=report.requests.find(r=>r.key===key);if(previous&&['RETRIEVED','EMPTY_OFFICIAL_RESPONSE'].includes(previous.status)&&Date.now()-Date.parse(previous.checked_at)<86400000)continue;
   const row={key,station_id:id,station_code:code,...w};let response;
   for(let attempt=1;attempt<=2;attempt++){try{response=await fetchHistory(code,w.from.replaceAll('-',''),w.to.replaceAll('-',''));break;}catch(e){row.reason=safeError(e);row.attempts=attempt;}}
   if(response){const records=response.records.filter(r=>r.observedAt>=w.from&&r.observedAt<=w.to+' 23:59:59');const unique=[...new Map(records.map(r=>[r.observedAt,r])).values()];const digest=crypto.createHash('sha256').update(JSON.stringify(unique)).digest('hex');let inserted=0;
    for(let i=0;i<unique.length;i+=250){const batch=unique.slice(i,i+250);const [r]=await db.query(`INSERT IGNORE INTO ml_verified_water_history(station_id,observed_at,water_level,source_url,response_sha256,retrieved_at) VALUES ${batch.map(()=>'(?,?,?,?,?,UTC_TIMESTAMP())').join(',')}`,batch.flatMap(r=>[id,r.observedAt,r.waterLevel,response.source_url,digest]));inserted+=r.affectedRows;}
    Object.assign(row,{status:unique.length?'RETRIEVED':'EMPTY_OFFICIAL_RESPONSE',received:unique.length,inserted,source_url:response.source_url,response_sha256:digest,first:unique[0]?.observedAt,last:unique.at(-1)?.observedAt});failures=0;
   }else{row.status='SOURCE_UNAVAILABLE';failures++;}row.checked_at=new Date().toISOString();const old=report.requests.findIndex(r=>r.key===key);if(old<0)report.requests.push(row);else report.requests[old]=row;state.windows_requested++;save();
   if(failures>=3){report.stopped_reason='THREE_CONSECUTIVE_OFFICIAL_SOURCE_FAILURES';save();return report;}
  }
  state.completed_at=new Date().toISOString();const old=report.stations.findIndex(s=>s.station_id===id);if(old<0)report.stations.push(state);else report.stations[old]=state;save();console.log(JSON.stringify({station:id,processed:report.stations.length,targets:targets.length,inserted:report.inserted}));
 }
 delete report.stopped_reason;report.completed_at=new Date().toISOString();save();return report;
}
if(require.main===module){const db=require('./db');const ids=process.argv.slice(2).map(Number);repair({db,ids:ids.length?ids:null}).then(r=>console.log(JSON.stringify({processed:r.stations.length,inserted:r.inserted,stopped:r.stopped_reason||null}))).catch(e=>{console.error(safeError(e));process.exitCode=1}).finally(()=>db.end());}module.exports={missingWindows,repair};
