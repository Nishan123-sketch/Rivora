'use strict';
const {fetchDay}=require('./hrfco-fetch-history');
const {importResponse}=require('./hrfco-warning-history');
const INTERVAL_MS=30*60*1000;
let timer=null,running=false;
let status={status:'NOT_CONFIGURED',last_attempt_at:null,last_success_at:null,
  last_imported_events:0,last_error:null,coverage:'PARTIAL_BULLETIN_FEED_NOT_CERTIFIED_ACTIVE_WARNING_STATE'};
function kstDate(now=Date.now()){
  const t=new Date(now+9*3600000).toISOString().slice(0,10);
  return t.replaceAll('-','');
}
function previousDate(date){
  const ms=Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8))-86400000;
  return new Date(ms).toISOString().slice(0,10).replaceAll('-','');
}
function getFeedStatus(){return {...status};}
async function poll({key=process.env.HRFCO_SERVICE_KEY,db,now=Date.now(),fetchImpl=fetch}={}){
  if(running)return getFeedStatus();
  if(!key){status={...status,status:'NOT_CONFIGURED',last_error:null};return getFeedStatus();}
  running=true;
  status={...status,status:'CHECKING',last_attempt_at:new Date(now).toISOString()};
  try{
    const database=db||require('./db');
    const today=kstDate(now),days=[today,previousDate(today)];
    let successes=0,imports=0;const failures=[];
    for(const day of days){
      try{
        const result=await fetchDay(key,day,fetchImpl);
        const r=await importResponse(database,result);
        successes++;imports+=r.records;
      }catch(error){
        // 990 is not evidence that there is no active flood warning.
        failures.push(String(error.message).replaceAll(key,'[REDACTED]').slice(0,140));
      }
    }
    status={...status,status:successes===days.length?'RECENT_BULLETINS_FETCHED':
      successes?'PARTIAL_RECENT_BULLETINS':'UNAVAILABLE_OR_NO_MATCH',
      last_success_at:successes?new Date(now).toISOString():status.last_success_at,
      last_imported_events:imports,
      last_error:failures.length?`${failures.length} date queries returned no usable data or failed`:null};
    return getFeedStatus();
  } finally {running=false;}
}
function startPoll(){
  if(timer||!process.env.HRFCO_SERVICE_KEY)return timer;
  // Independent startup: optional official-feed failures never take down Express.
  setTimeout(()=>void poll().catch(e=>console.warn('[HRFCO feed]',e.code||e.message)),90000).unref?.();
  timer=setInterval(()=>void poll().catch(e=>console.warn('[HRFCO feed]',e.code||e.message)),INTERVAL_MS);
  console.log('[HRFCO] Optional flood-bulletin collector enabled (30-minute polling; no claim of confirmed active-warning coverage).');
  return timer;
}
module.exports={kstDate,previousDate,poll,getFeedStatus,startPoll};
