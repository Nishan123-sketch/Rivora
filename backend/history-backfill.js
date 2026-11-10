'use strict';
require('dotenv').config();
const fs=require('fs'),path=require('path');
const DAY=86400000;
function rollingStart(now=Date.now()){const d=new Date(now+9*3600000);d.setUTCMonth(d.getUTCMonth()-13);return d.toISOString().slice(0,10);}
function chunks(start,end,days=90){const a=Date.parse(start),b=Date.parse(end);if(!Number.isFinite(a)||!Number.isFinite(b)||a>b||days<1)throw Error('Invalid backfill range');const result=[];for(let t=a;t<=b;t+=days*DAY)result.push([new Date(t).toISOString().slice(0,10),new Date(Math.min(b,t+(days-1)*DAY)).toISOString().slice(0,10)]);return result;}
async function retry(fn){let last;for(let attempt=0;attempt<3;attempt++){try{return await fn();}catch(e){last=e;if(attempt<2)await new Promise(r=>setTimeout(r,1000*2**attempt));}}throw last;}
async function backfill({db=require('./db'),getWamis=require('./wamis-client').getWamis,stationId=null,start=rollingStart(),end=new Date(Date.now()+9*3600000).toISOString().slice(0,10),checkpointFile=path.join(__dirname,'reports','completion-history-checkpoint.json')}={}){
 const {mapReadings}=require('./wamis-client');
 const [stations]=await db.execute("SELECT station_id,external_station_id FROM stations WHERE data_source='RIVER_GAUGE'"+(stationId?' AND station_id=?':'')+' ORDER BY (external_station_id=2201670) DESC,station_id',stationId?[stationId]:[]);
 let checkpoint={};try{checkpoint=JSON.parse(fs.readFileSync(checkpointFile,'utf8'));}catch{/* first run */}
 fs.mkdirSync(path.dirname(checkpointFile),{recursive:true});let failures=0;
 for(const s of stations)for(const [from,to] of chunks(start,end)){
  const key=`${s.station_id}:${from}:${to}`;if(checkpoint[key]?.completed)continue;
  try{const rows=mapReadings(await retry(()=>getWamis('wl_hrdata',{obscd:s.external_station_id,startdt:from.replaceAll('-',''),enddt:to.replaceAll('-','')},30000))).filter(r=>r.observedAt.slice(0,10)>=from&&r.observedAt.slice(0,10)<=to);
   if(!rows.length)throw Error('NO_DATA_RETURNED');
   for(let i=0;i<rows.length;i+=250){const batch=rows.slice(i,i+250);await db.query(`INSERT INTO water_readings(station_id,observed_at,water_level) VALUES ${batch.map(()=>'(?,?,?)').join(',')} ON DUPLICATE KEY UPDATE water_level=VALUES(water_level)`,batch.flatMap(r=>[s.station_id,r.observedAt,r.waterLevel]));}
   // A non-empty response is not proof the provider returned the requested period.
   const dates=new Set(rows.map(r=>r.observedAt.slice(0,10)));const expected=Math.round((Date.parse(to)-Date.parse(from))/DAY)+1;
   checkpoint[key]={completed:dates.size>=expected*0.8,rows:rows.length,days:dates.size,expected_days:expected};if(!checkpoint[key].completed)failures++;
  }catch(e){checkpoint[key]={completed:false,reason:e.code||e.message};failures++;}
  fs.writeFileSync(checkpointFile,JSON.stringify(checkpoint,null,2));console.log('Water history',key,checkpoint[key].completed?'saved':'incomplete');
 }
 await require('./history-daily').refreshDaily(db);return {failures};
}
if(require.main===module){const db=require('./db');backfill({start:process.argv[2]||rollingStart(),end:process.argv[3]||undefined}).then(r=>{if(r.failures)process.exitCode=1;}).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>db.end());}
module.exports={rollingStart,chunks,backfill,retry};
