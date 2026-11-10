// Reconcile station-specific official thresholds. No inferred or synthetic thresholds.
'use strict';
require('dotenv').config();
const fs=require('fs'),path=require('path');
const {normalizeStationInfo,getWamis,mapReadings,parseCoord}=require('./wamis-client');
const {measurementType}=require('./gauge-risk-safety');
const {registerRiver}=require('./river-network-registry');
const {eligible}=require('./official-station-policy');
function sameStationName(a,b){const clean=v=>String(v||'').replace(/\s/g,'');if(clean(a)===clean(b))return true;const bridge=v=>clean(v).match(/\(([^)]+)\)/)?.[1];return !!bridge(a)&&bridge(a)===bridge(b);}
const supplement=require('./reference-data/official-river-metadata-supplement.json');
const SCHEMA=`CREATE TABLE IF NOT EXISTS official_station_registry(station_code VARCHAR(50) PRIMARY KEY,authority VARCHAR(40) NOT NULL,designation VARCHAR(40) NOT NULL,source_url VARCHAR(1000) NOT NULL,checked_at DATETIME NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const number=v=>v===null||v===undefined||String(v).trim()===''||!Number.isFinite(Number(v))?null:Number(v);
function normalize(row,authority){if(authority==='Yeongsan'&&row.wl_code)row={...row,attwl:row.wl_wrn,wrnwl:row.wl_alm,almwl:row.wl_att,srswl:row.wl_srs};const code=String(row.wlobscd||row.WLOBSCD||row.wl_code||'');const levels=[row.attwl??row.wl_att,row.wrnwl??row.WRNWL??row.wl_wrn,row.almwl??row.ALMWL??row.wl_alm,row.srswl??row.wl_srs].map(number);return {code,name:row.obsnm||row.OBSNM||row.wl_name,authority,levels,advisory:levels[1],warning:levels[2],four:levels.every((v,i)=>v!==null&&v>0&&(!i||v>levels[i-1])),valid:/^\d{5,12}$/.test(code)&&levels[1]!==null&&levels[1]>0&&levels[2]>levels[1],water:require('./wamis-client').levelOrNull(row.wl??row.TM),datum:number(row.gdt),designation:['Han','Nakdong','Geum','Yeongsan'].includes(authority)&&['Y','N'].includes(row.fstnyn)?(row.fstnyn==='Y'?'DESIGNATED_WARNING':row.fstnyn==='N'?'PUBLISHED_THRESHOLD':'UNCONFIRMED'):['Nakdong','Geum','Yeongsan'].includes(authority)?'DESIGNATED_WARNING':'UNCONFIRMED'};}
async function jsonPostOnce(url,params){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('SOURCE_HTTP_'+response.status);let d=await response.json();if(typeof d==='string')d=JSON.parse(d);const rows=d.Data||d;if(!Array.isArray(rows))throw Error('INVALID_SOURCE');return rows;}
async function jsonPost(url,params){let last;for(let attempt=0;attempt<3;attempt++){try{return await jsonPostOnce(url,params);}catch(e){last=e;}}throw last;}
async function run(db=require('./db'),{reportFile=path.join(__dirname,'reports/national-reconciliation.json'),authorities=null,stationCodes=null}={}){
 await db.query(SCHEMA);
 const observedAt=new Date(Date.now()+9*3600000-3600000).toISOString().slice(0,13).replace('T',' ')+':00:00',stamp=observedAt.replace(/[- :]/g,'').slice(0,12);
 const sources=[
 {authority:'Han',endpoint:'https://www.hrfco.go.kr/servlet/sumun/wlList.do',url:'https://www.hrfco.go.kr/sumun/waterlevelList.do',params:{Type:'basin',obscd:'all',obsnm:'',ymdhm:stamp}},
 {authority:'Nakdong',endpoint:'https://www.nakdongriver.go.kr/sumun/servlet/rthdlatLonList.do',url:'https://www.nakdongriver.go.kr/sumun/rthd.do',params:{check:'wl',ymdhm:stamp}},
 {authority:'Geum',endpoint:'https://www.geumriver.go.kr/servlet/sumun.SumunFloodServlet',url:'https://www.geumriver.go.kr/html/flood/floodPopup.jsp',params:{dataType:'wlList',edt:stamp}},
 {authority:'Yeongsan',endpoint:'https://www.yeongsanriver.go.kr/sumun/wlMapJson.do',url:'https://www.yeongsanriver.go.kr/sumun/wlMap.do',params:{sel_syear:stamp.slice(0,4),sel_smon:stamp.slice(4,6),sel_sday:stamp.slice(6,8),sel_shour:stamp.slice(8,10),sel_smin:stamp.slice(10,12)}}].filter(s=>!authorities||authorities.includes(s.authority));
 const report={checked_at:new Date().toISOString(),observation_requested_at:observedAt,sources:[],stations:[]};
 const save=()=>{fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');};
 const results=await Promise.allSettled(sources.map(s=>jsonPost(s.endpoint,s.params)));
 const [existingThresholds]=await db.query('SELECT * FROM flood_thresholds');
 const catalog=[];
 results.forEach((result,i)=>{const s=sources[i];if(result.status==='rejected'){report.sources.push({authority:s.authority,status:'UNAVAILABLE',reason:result.reason.message});return;}report.sources.push({authority:s.authority,status:'FETCHED',records:result.value.length,designated:result.value.filter(r=>normalize(r,s.authority).designation==='DESIGNATED_WARNING').length,source_url:s.url});for(const raw of result.value)catalog.push({...normalize(raw,s.authority),source:s,raw});});
 fs.mkdirSync(path.join(__dirname,'reference-data'),{recursive:true});fs.writeFileSync(path.join(__dirname,'reference-data/official-network-snapshot'+(authorities?'-'+authorities.join('-'):'')+'.json'),JSON.stringify({checked_at:report.checked_at,sources:sources.map((s,i)=>({...s,rows:results[i].status==='fulfilled'?results[i].value:[]}))}));
 const [existing]=await db.query("SELECT s.*,l.source_river_name,l.verification_status AS link_status FROM stations s LEFT JOIN river_gauge_links l ON l.station_id=s.station_id WHERE s.data_source='RIVER_GAUGE'");
 let cache={stations:{}};const cacheFile=path.join(__dirname,'wamis-gauge-discovery-cache.json');try{cache=JSON.parse(fs.readFileSync(cacheFile,'utf8'));}catch{}cache.stations||={};
 for(const row of catalog){if(stationCodes&&!stationCodes.includes(row.code))continue;
  const entry={code:row.code,authority:row.authority,name:row.name,designation:row.designation,source_url:row.source.url};report.stations.push(entry);
  if(!/^\d{5,12}$/.test(row.code)){entry.status='INVALID_STATION_CODE';continue;}
  await db.execute(`INSERT INTO official_station_registry(station_code,authority,designation,source_url,checked_at) VALUES(?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE authority=VALUES(authority),designation=VALUES(designation),source_url=VALUES(source_url),checked_at=VALUES(checked_at)`,[row.code,row.authority,row.designation,row.source.url]);
  if(!row.valid){entry.status='NO_ORDERED_PUBLISHED_THRESHOLDS';save();continue;}
  if(measurementType(row.name)==='POTENTIAL_DAM_OR_RESERVOIR'){entry.status='DAM_EXCLUDED';save();continue;}
  const old=existing.find(s=>String(s.external_station_id)===row.code);const previous=existingThresholds.find(t=>t.station_id===old?.station_id);if(old&&eligible({...old,...previous})&&Number(previous.advisory_level_m??previous.caution_level_m)===row.advisory&&Number(previous.warning_level_m??previous.alert_level_m)===row.warning&&(!row.four||row.levels.every((v,i)=>Number(previous[['interest_level_m','caution_level_m','alert_level_m','severe_level_m'][i]])===v))){Object.assign(entry,{status:'VERIFIED',station_id:old.station_id,added:false,advisory:row.advisory,warning:row.warning});save();continue;}let meta=null;const primaryLocation={latitude:row.raw.lat,longitude:row.raw.lon};if(row.authority==='Nakdong'&&row.raw.rvnm&&require('./geo').located(primaryLocation))meta={code:row.code,stationName:row.name,riverName:String(row.raw.rvnm).trim(),lat:Number(row.raw.lat),lon:Number(row.raw.lon),metadata_source_url:row.source.url,river_reference_url:row.source.url};meta||=cache.stations[row.code]?.station;
  try{
   if(!meta&&old?.link_status==='VERIFIED'&&old.source_river_name&&old.coordinate_source_url?.includes('wamis.go.kr')&&Number.isFinite(Number(old.latitude))&&Number.isFinite(Number(old.longitude)))meta={code:row.code,riverName:old.source_river_name,stationName:old.station_name,lat:Number(old.latitude),lon:Number(old.longitude)};
   if(!meta){const rows=await getWamis('wl_obsinfo',{obscd:row.code},10000);const raw=rows.find(r=>String(r.obscd||r.wlobscd)===row.code);meta=normalizeStationInfo(raw);const ref=supplement[row.code];if(!meta&&raw&&ref&&sameStationName(raw.obsnm,ref.station_name)){const candidate=normalizeStationInfo({...raw,rivnm:ref.river_name});const location={latitude:parseCoord(ref.lat_dms,'lat'),longitude:parseCoord(ref.lon_dms,'lon')};if(candidate&&require('./geo').haversine({latitude:candidate.lat,longitude:candidate.lon},location)<=1)meta={...candidate,river_reference_url:ref.source_url};}}
   if(!meta||meta.code!==row.code)throw Error('METADATA_NOT_CONFIRMED');
   cache.stations[row.code]={...(cache.stations[row.code]||{}),station:meta,fetchedAt:new Date().toISOString()};
   let water=row.water,datum=row.datum,sourceUrl=row.source.url;
   if(row.authority==='Yeongsan'){
    const params={wlobscd:row.code};const [day,clock]=observedAt.split(' '),[year,month,date]=day.split('-'),[hour,minute]=clock.split(':');for(const side of ['s','e'])Object.assign(params,{['sel_'+side+'year']:year,['sel_'+side+'mon']:month,['sel_'+side+'day']:date,['sel_'+side+'hour']:hour,['sel_'+side+'min']:minute});
    const rows=await jsonPost('https://www.yeongsanriver.go.kr/sumun/wlChart.do',params),reading=rows.find(r=>r.timeList===`${month}.${date} ${hour}:${minute}`),t=rows.find(r=>r.wrnList!==undefined);datum=number(rows.find(r=>r.gdt!==undefined)?.gdt);water=number(reading?.wlList);
    if(water===null||datum===null||number(t?.wrnList)!==row.advisory||number(t?.almList)!==row.warning)throw Error('SOURCE_CHART_IDENTITY_OR_DATUM_NOT_CONFIRMED');sourceUrl='https://www.yeongsanriver.go.kr/sumun/waterDetail.do?wlobscd='+row.code;
   }
   if(water===null&&datum===null)throw Error('NO_VALID_SOURCE_READING_OR_DOCUMENTED_DATUM');
   let evidence='';
   if(datum!==null)evidence='GDT:'+datum+';PRIMARY:STATION_METADATA_AND_PUBLISHED_THRESHOLDS';
   else {
    const [[stored]]=old?await db.execute('SELECT water_level FROM water_readings WHERE station_id=? AND observed_at=?',[old.station_id,observedAt]):[[]];let match=number(stored?.water_level);
    if(match===null){const records=await getWamis('wl_hrdata',{obscd:row.code,startdt:stamp.slice(0,8)},12000);match=number(mapReadings(records).find(r=>r.observedAt===observedAt)?.waterLevel);}
    if(match===null||Math.abs(match-water)>0.011)throw Error('SAME_TIME_WAMIS_DATUM_NOT_CONFIRMED');evidence='MATCH:'+stamp+';WAMIS_SAME_TIME_STAGE';
   }
   const river=registerRiver(meta);if(!river)throw Error('RIVER_NOT_IDENTIFIED');
   const c=await db.getConnection();try{await c.beginTransaction();let id=old?.station_id;const metadataUrl=meta.metadata_source_url||'http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_obsinfo?obscd='+row.code+'&output=json';
    if(!id){const [result]=await c.execute("INSERT INTO stations(station_name,latitude,longitude,data_source,external_station_id,coordinate_source_url) VALUES(?,?,?,'RIVER_GAUGE',?,?)",[meta.stationName,meta.lat,meta.lon,row.code,metadataUrl]);id=result.insertId;}
    await c.execute("INSERT INTO river_gauge_links(river_id,station_id,verification_status,reference_url,verified_at,source_river_name,verification_method,last_verified_observation_at) VALUES(?,?,'VERIFIED',?,UTC_TIMESTAMP(),?,'OFFICIAL_STATION_CODE_AND_METADATA',?) ON DUPLICATE KEY UPDATE verification_status='VERIFIED',reference_url=VALUES(reference_url),verified_at=UTC_TIMESTAMP()",[river.river_id,id,meta.river_reference_url||metadataUrl,meta.riverName,observedAt]);
    const four=row.four;
    await c.execute(`INSERT INTO flood_thresholds(station_id,interest_level_m,caution_level_m,alert_level_m,severe_level_m,advisory_level_m,warning_level_m,verification_status,source_url,verified_at,reference_source) VALUES(?,?,?,?,?,?,?,'VERIFIED',?,UTC_TIMESTAMP(),?) ON DUPLICATE KEY UPDATE interest_level_m=VALUES(interest_level_m),caution_level_m=VALUES(caution_level_m),alert_level_m=VALUES(alert_level_m),severe_level_m=VALUES(severe_level_m),advisory_level_m=VALUES(advisory_level_m),warning_level_m=VALUES(warning_level_m),verification_status='VERIFIED',source_url=VALUES(source_url),verified_at=UTC_TIMESTAMP(),reference_source=VALUES(reference_source)`,[id,...(four?row.levels:[null,null,null,null]),row.advisory,row.warning,sourceUrl,(four?'':'SCHEME:TWO_STAGE;')+'WAMIS:'+row.code+';DATUM:REQUIRES_INDEPENDENT_REVIEW;'+evidence]);
    if(water!==null)await c.execute('INSERT INTO water_readings(station_id,observed_at,water_level,source_url) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE source_url=COALESCE(source_url,VALUES(source_url))',[id,observedAt,water,sourceUrl]);await c.commit();Object.assign(entry,{station_id:id,status:'VERIFIED',added:!old,advisory:row.advisory,warning:row.warning,river:meta.riverName,observation_status:water===null?'MISSING':'SOURCE_READING'});
   }catch(e){await c.rollback();throw e;}finally{c.release();}
  }catch(e){entry.status=e.code||e.message;}
  fs.writeFileSync(cacheFile,JSON.stringify(cache,null,2));if(row.designation==='DESIGNATED_WARNING'||entry.added)console.log(row.authority,row.code,entry.status,entry.added?'ADDED':'');save();
 }
 fs.writeFileSync(cacheFile,JSON.stringify(cache,null,2));
 await require('./link-nearest-rainfall').run(db);
 const [all]=await db.query('SELECT s.external_station_id,s.station_name,s.data_source,t.* FROM stations s LEFT JOIN flood_thresholds t ON t.station_id=s.station_id');const included=new Set(all.filter(eligible).map(r=>String(r.external_station_id)));
 report.summary={catalog_records:catalog.length,designated_catalog:catalog.filter(r=>r.designation==='DESIGNATED_WARNING').length,verified_monitored:included.size,added:report.stations.filter(r=>r.added).length,designated_monitored:catalog.filter(r=>r.designation==='DESIGNATED_WARNING'&&included.has(r.code)).length,unresolved:report.stations.filter(r=>r.status!=='VERIFIED').length};save();console.log(JSON.stringify(report.summary));return report;
}
if(require.main===module){const db=require('./db');run(db).catch(e=>{console.error(e.code||e.message);process.exitCode=1}).finally(()=>db.end());}
module.exports={normalize,run,SCHEMA};
