// Refresh observations only for gauges whose station thresholds have already passed verification.
'use strict';
const {levelOrNull}=require('./wamis-client');
let pending=null,timer=null;
function requestedTime(now=Date.now()){return new Date(Math.floor((now+9*3600000-10*60000)/600000)*600000).toISOString().slice(0,16).replace(/[-T:]/g,'');}
function reading(row,authority,stamp){const code=String(row.wlobscd||row.WLOBSCD||row.wl_code||'');const reported=row.wl_ymdhm||row.ymdhm;if(reported&&String(reported)!==stamp)return null;const water=levelOrNull(row.wl??row.TM);if(!/^\d{5,12}$/.test(code)||water===null)return null;if(authority==='Han'&&row.wloffchk!=null&&String(row.wloffchk)!=='0')return null;return {code,water,observedAt:`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)} ${stamp.slice(8,10)}:${stamp.slice(10,12)}:00`};}
async function sourceRows(endpoint,params,fetcher){let last;for(let attempt=0;attempt<3;attempt++){try{const r=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP_'+r.status);let d=await r.json();if(typeof d==='string')d=JSON.parse(d);const rows=d.Data||d;if(!Array.isArray(rows))throw Error('INVALID_SOURCE');return rows;}catch(e){last=e;}}throw last;}
async function sync(db=require('./db'),fetcher=fetch,now=Date.now()){
 if(pending)return pending;
 pending=(async()=>{const stamp=requestedTime(now);const allowed=await require('./official-station-policy').ids();const [stations]=await db.query("SELECT station_id,external_station_id FROM stations WHERE data_source='RIVER_GAUGE'");const ids=new Map(stations.filter(s=>allowed.has(String(s.station_id))).map(s=>[String(s.external_station_id),s.station_id]));
 const hanStamp=new Date(now+9*3600000-3600000).toISOString().slice(0,13).replace(/[-T]/g,'')+'00';
 const sources=[
 ['Han','https://www.hrfco.go.kr/servlet/sumun/wlList.do','https://www.hrfco.go.kr/sumun/waterlevelList.do',{Type:'basin',obscd:'all',obsnm:'',ymdhm:hanStamp}],
 ['Nakdong','https://www.nakdongriver.go.kr/sumun/servlet/rthdlatLonList.do','https://www.nakdongriver.go.kr/sumun/rthd.do',{check:'wl',ymdhm:stamp}],
 ['Geum','https://www.geumriver.go.kr/servlet/sumun.SumunFloodServlet','https://www.geumriver.go.kr/html/flood/floodPopup.jsp',{dataType:'wlList',edt:stamp}],
 ['Yeongsan','https://www.yeongsanriver.go.kr/sumun/wlMapJson.do','https://www.yeongsanriver.go.kr/sumun/wlMap.do',{sel_syear:stamp.slice(0,4),sel_smon:stamp.slice(4,6),sel_sday:stamp.slice(6,8),sel_shour:stamp.slice(8,10),sel_smin:stamp.slice(10,12)}]];
 const result=await Promise.all(sources.map(async([authority,endpoint,url,params])=>{try{const rows=await sourceRows(endpoint,params,fetcher);const values=rows.map(row=>reading(row,authority,authority==='Han'?hanStamp:stamp)).filter(row=>row&&ids.has(row.code)).map(row=>[ids.get(row.code),row.observedAt,row.water,url]);let inserted=0;for(let i=0;i<values.length;i+=100){const [saved]=await db.query('INSERT IGNORE INTO water_readings(station_id,observed_at,water_level,source_url) VALUES ?',[values.slice(i,i+100)]);inserted+=saved.affectedRows;}return {authority,observation_requested_stamp:authority==='Han'?hanStamp:stamp,matched:values.length,inserted};}catch(e){return {authority,status:'UNAVAILABLE',reason:e.code||e.name||'SOURCE_ERROR'};}}));console.log('[Official river feeds]',JSON.stringify({requested_stamp:stamp,sources:result}));return {requested_stamp:stamp,sources:result};})().finally(()=>pending=null);return pending;
}
function start(){if(timer)return timer;const update=()=>void sync().catch(e=>console.error('[Official river feeds]',e.code||e.message));setTimeout(update,15000).unref();timer=setInterval(update,10*60000);timer.unref();return timer;}
if(require.main===module){require('dotenv').config();const db=require('./db');sync(db).catch(e=>{console.error(e.code||e.message);process.exitCode=1}).finally(()=>db.end());}
module.exports={requestedTime,reading,sync,start};
