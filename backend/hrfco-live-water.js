'use strict';
const {configuredKey}=require('./hrfco-fetch-history');
const {parseKoreanTimestamp}=require('./hrfco-warning-history');
const {levelOrNull}=require('./wamis-client');
const PUBLIC_SOURCE='https://www.hrfco.go.kr/web/openapiPage/reference.do#waterlevel';
function reading(raw,now=Date.now()){
 const code=String(raw.wlobscd||''),stamp=String(raw.ymdhm||'');
 const observed_at=parseKoreanTimestamp(stamp.length===10?stamp+'00':stamp),water_level=levelOrNull(raw.wl);
 if(!/^\d{5,12}$/.test(code)||!observed_at||water_level===null)return null;
 const age=now-Date.parse(observed_at.replace(' ','T')+'+09:00');if(age<0||age>3*3600000)return null;
 const flow=raw.fw==null||String(raw.fw).trim()===''?null:Number(raw.fw);
 return {code,observed_at,water_level,flow_rate:Number.isFinite(flow)&&flow>=0?flow:null};
}
let pending=null;
async function run({db=require('./db'),fetcher=fetch,key=process.env.HRFCO_SERVICE_KEY,now=Date.now(),verifyReferences=require('./measurement-reference-verifier').verify}={}){
 const token=configuredKey(key);if(!/^[a-zA-Z0-9-]{20,120}$/.test(token))return {status:'NOT_CONFIGURED'};
 const response=await fetcher(`https://api.hrfco.go.kr/${encodeURIComponent(token)}/waterlevel/list/10M.json`,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('HRFCO_LIVE_HTTP_'+response.status);const payload=await response.json();if(!Array.isArray(payload.content))throw Error('HRFCO_LIVE_RESPONSE_UNAVAILABLE');
 const [stations]=await db.query("SELECT station_id,external_station_id FROM stations WHERE data_source='RIVER_GAUGE'");const index=new Map(stations.map(s=>[String(s.external_station_id),s.station_id]));
 const rows=payload.content.map(r=>reading(r,now)).filter(r=>r&&index.has(r.code));let inserted=0;
 for(let i=0;i<rows.length;i+=200){const batch=rows.slice(i,i+200);const [result]=await db.query(`INSERT IGNORE INTO water_readings(station_id,observed_at,water_level,flow_rate,source_url) VALUES ${batch.map(()=>'(?,?,?,?,?)').join(',')}`,batch.flatMap(r=>[index.get(r.code),r.observed_at,r.water_level,r.flow_rate,PUBLIC_SOURCE]));inserted+=result.affectedRows;}
 let reference_verification;try{reference_verification=await verifyReferences(rows,db);}catch(e){reference_verification={status:'UNAVAILABLE',reason:e.code||e.name};}
 return {status:'IMPORTED',fresh_gauges:new Set(rows.map(r=>r.code)).size,inserted,reference_verification,source_url:PUBLIC_SOURCE,checked_at:new Date(now).toISOString()};
}
function refresh(options){if(pending)return pending;pending=run(options).finally(()=>pending=null);return pending;}
function start(){if(!process.env.HRFCO_SERVICE_KEY)return;const tick=()=>{void refresh().then(r=>console.log('[HRFCO live]',JSON.stringify(r))).catch(e=>console.warn('[HRFCO live]',e.code||e.name));void require('./hrfco-feature-history').refreshLatestRain().catch(e=>console.warn('[HRFCO rain]',e.code||e.name));};void tick();const timer=setInterval(tick,5*60000);timer.unref();return timer;}
if(require.main===module){require('dotenv').config();const db=require('./db');refresh({db}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.code||e.name);process.exitCode=1;}).finally(()=>db.end());}
module.exports={reading,refresh,start};
