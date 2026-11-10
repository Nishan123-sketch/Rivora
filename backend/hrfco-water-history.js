'use strict';
const {configuredKey}=require('./hrfco-fetch-history');
const {parseKoreanTimestamp}=require('./hrfco-warning-history');
let nextRequest=0;
async function fetchHourlyHistory(code,start,end,{key=process.env.HRFCO_SERVICE_KEY,fetcher=fetch}={}){
 if(!/^\d{5,12}$/.test(String(code))||!/^\d{8}$/.test(start)||!/^\d{8}$/.test(end))throw Error('INVALID_HRFCO_HISTORY_REQUEST');
 const token=configuredKey(key);if(!/^[0-9A-Za-z-]{20,120}$/.test(token))throw Error('HRFCO_KEY_UNAVAILABLE');
 const slot=Math.max(Date.now(),nextRequest);nextRequest=slot+1000;if(slot>Date.now())await new Promise(r=>setTimeout(r,slot-Date.now()));
 const today=new Date(Date.now()+9*3600000).toISOString().replace(/[-:T]/g,'').slice(0,10);
 const until=end===today.slice(0,8)?today:end+'23';
 const response=await fetcher(`https://api.hrfco.go.kr/${encodeURIComponent(token)}/waterlevel/list/1H/${code}/${start}00/${until}.json`,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('HRFCO_HTTP_'+response.status);
 const payload=await response.json();if(!Array.isArray(payload.content))throw Error('HRFCO_SERVICE_'+String(payload.code||'INVALID_RESPONSE'));
 const records=[];for(const raw of payload.content){if(String(raw.wlobscd)!==String(code))throw Error('HRFCO_STATION_MISMATCH');const stamp=String(raw.ymdhm||'');const at=parseKoreanTimestamp(stamp.length===10?stamp+'00':stamp);const value=require('./wamis-client').levelOrNull(raw.wl);if(at&&value!==null)records.push({observedAt:at,waterLevel:value});}
 return {records:records.sort((a,b)=>a.observedAt.localeCompare(b.observedAt)),source_url:'https://www.hrfco.go.kr/web/openapiPage/reference.do#waterlevel',request_template:'https://api.hrfco.go.kr/{service-key}/waterlevel/list/1H/{station}/{start}/{end}.json',station_code:String(code),start:start+'00',end:until};
}
module.exports={fetchHourlyHistory};
