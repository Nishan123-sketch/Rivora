'use strict';
// Exact-observation reconciliation, NOT a claim about an undocumented datum epoch.
// The reviewed official chart puts WL and ATT/WRN/ALM/SRS on gauge-height axis 0;
// its separate elevation axis and cross-section explicitly use GDT (EL.m).
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const DOC='https://www.hrfco.go.kr/web/openapiPage/reference.do';
const SCRIPT='https://www.hrfco.go.kr/js/sumun/wl/wl_popup.js';
const REVIEWED_SCRIPT='897ff43823e1ec226b098c9fc4fb513faa6990e804483607f2ba687cec3f7105';
const EXCLUSIONS={'1022640':'The official-feed WL reading is retained; its physical measurement reference and validity remain unresolved. Published caution/alert stages cannot safely classify this reading. No conversion has been applied.','1018680':'Published stages refer to submersion and traffic controls, not the ordinary flood-stage scheme.','1021650':'Published stages refer to evacuation and border-response controls, not the ordinary flood-stage scheme.'};
const num=v=>v==null||String(v).trim()===''||!Number.isFinite(Number(v))?null:Number(v);
let metadataCache=null;
function certificate(row,observation,metadata,now=Date.now()){
 const code=String(row.external_station_id||'');if(EXCLUSIONS[code])return {reason:'MANUAL_MEASUREMENT_OR_SCHEME_REVIEW'};
 if(!observation||String(observation.code)!==code||!metadata||String(metadata.wlobscd)!==code)return {reason:'NO_MATCHED_OFFICIAL_OBSERVATION'};
 if(row.observed_at!==observation.observed_at||num(row.water_level)===null||Math.abs(Number(row.water_level)-observation.water_level)>.00051)return {reason:'OBSERVATION_NOT_IDENTICAL'};
 if(row.verification_status!=='VERIFIED'||!row.verified_at||!String(row.reference_source||'').includes('WAMIS:'+code+';'))return {reason:'PUBLISHED_THRESHOLD_IDENTITY_NOT_VERIFIED'};
 const lower=num(row.advisory_level_m??row.caution_level_m),upper=num(row.warning_level_m??row.alert_level_m),gdt=num(metadata.gdt);
 if(lower===null||upper===null||gdt===null||lower>=upper||lower!==num(metadata.wrnwl)||upper!==num(metadata.almwl))return {reason:'OFFICIAL_METADATA_OR_THRESHOLDS_DIFFER'};
 if(row.interest_level_m!=null&&['interest_level_m','caution_level_m','alert_level_m','severe_level_m'].some((k,i)=>num(row[k])!==num(metadata[['attwl','wrnwl','almwl','srswl'][i]])))return {reason:'FOUR_STAGE_METADATA_DIFFER'};
 const official=require('./wamis-client');const location={latitude:official.parseCoord(metadata.lat,'lat'),longitude:official.parseCoord(metadata.lon,'lon')};
 if(!require('./geo').located(location)||!require('./geo').located(row)||require('./geo').haversine(row,location)>1)return {reason:'STATION_COORDINATES_NOT_RECONCILED'};
 let source;try{source=new URL(row.source_url);}catch{return {reason:'THRESHOLD_SOURCE_NOT_VERIFIED'};}
 if(source.protocol!=='https:'||!/(^|\.)(hrfco|wamis|nakdongriver|geumriver|yeongsanriver)\.go\.kr$/.test(source.hostname)||source.hostname==='api.hrfco.go.kr')return {reason:'THRESHOLD_SOURCE_NOT_PUBLIC'};
 const reference=`HRFCO_GAUGE_ZERO:${code}:GDT_EL_M:${gdt}`;
 return {entry:{station_code:code,review_status:'INDEPENDENTLY_VERIFIED',reviewed_at:new Date(now).toISOString(),scope:'EXACT_OFFICIAL_OBSERVATION',observation_unit:'m',threshold_unit:'m',observation_reference:reference,threshold_reference:reference,observation_document_url:DOC,threshold_document_url:row.source_url,observation_field:'wl',observation_source_prefixes:[DOC+'#waterlevel','https://www.hrfco.go.kr/sumun/waterlevelList.do','https://www.nakdongriver.go.kr/sumun/rthd.do','http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_hrdata?obscd='+code+'&'],valid_from:observation.observed_at,valid_until:observation.observed_at,observed_value_m:observation.water_level,advisory_m:lower,warning_m:upper,station_gdt_el_m:gdt,schema_source_url:SCRIPT,schema_sha256:REVIEWED_SCRIPT,note:'Only this independently matched official observation is authorized; no datum conversion or future interval is asserted.'}};
}
async function verify(observations,db=require('./db')){
 const [docResponse,scriptResponse]=await Promise.all([fetch(DOC,{signal:AbortSignal.timeout(15000)}),fetch(SCRIPT,{signal:AbortSignal.timeout(15000)})]);if(!docResponse.ok||!scriptResponse.ok)throw Error('REFERENCE_SCHEMA_UNAVAILABLE');
 const [doc,script]=await Promise.all([docResponse.text(),scriptResponse.text()]);
 if(crypto.createHash('sha256').update(script).digest('hex')!==REVIEWED_SCRIPT||!doc.includes('수위자료(단위 : m)')||!doc.includes('영점표고(단위:EL.m)')||!doc.includes('주의보 수위(단위:m)')||!doc.includes('경보 수위(단위:m)'))return {status:'SOURCE_SCHEMA_REVIEW_REQUIRED'};
 if(!metadataCache||Date.now()-metadataCache.at>3600000){const token=require('./hrfco-fetch-history').configuredKey(process.env.HRFCO_SERVICE_KEY);const r=await fetch(`https://api.hrfco.go.kr/${encodeURIComponent(token)}/waterlevel/info.json`,{signal:AbortSignal.timeout(15000)});const d=await r.json();if(!Array.isArray(d.content))throw Error('REFERENCE_METADATA_UNAVAILABLE');metadataCache={at:Date.now(),rows:new Map(d.content.map(m=>[String(m.wlobscd),m]))};}
 const [rows]=await db.query(`SELECT s.station_id,s.station_name,s.external_station_id,s.latitude,s.longitude,t.*,w.water_level,DATE_FORMAT(w.observed_at,'%Y-%m-%d %H:%i:%s') observed_at FROM stations s JOIN flood_thresholds t ON t.station_id=s.station_id LEFT JOIN water_readings w ON w.reading_id=(SELECT reading_id FROM water_readings WHERE station_id=s.station_id ORDER BY observed_at DESC,reading_id DESC LIMIT 1) WHERE s.data_source='RIVER_GAUGE'`);
 const observed=new Map(observations.map(r=>[r.code,r])),stations={},reasons={};for(const row of rows){const c=certificate(row,observed.get(String(row.external_station_id)),metadataCache.rows.get(String(row.external_station_id)));if(c.entry)stations[row.external_station_id]=c.entry;else reasons[c.reason]=(reasons[c.reason]||0)+1;}
 const report={description:'Exact-observation certificates independently reconciled against reviewed official field definitions, chart axes, station metadata, geometry and published thresholds. Not historical datum epochs.',generated_at:new Date().toISOString(),stations,excluded:EXCLUSIONS};
 const file=path.join(__dirname,'reference-data/measurement-reference-evidence.json');fs.writeFileSync(file+'.tmp',JSON.stringify(report,null,2));fs.renameSync(file+'.tmp',file);
 return {status:'RECONCILED',observations_verified:Object.keys(stations).length,reasons};
}
module.exports={certificate,verify,EXCLUSIONS};
