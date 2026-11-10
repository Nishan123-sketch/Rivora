'use strict';
// Deliberately separate from importer-authored DATUM:CONFIRMED and GDT tokens.
// Entries require an independently reviewed, effective-dated reference for BOTH
// observation and threshold fields. No numerical offset is inferred here.
const fs=require('fs'),path=require('path');let cached={mtime:null,stations:{}};
function entriesFromDisk(){try{const file=path.join(__dirname,'reference-data/measurement-reference-evidence.json'),mtime=fs.statSync(file).mtimeMs;if(cached.mtime!==mtime){const data=JSON.parse(fs.readFileSync(file,'utf8'));cached={mtime,stations:data.stations||{},excluded:data.excluded||{}};}return cached.stations;}catch{return {};}}
function compatibility(station,latest,threshold,entries=entriesFromDisk()){
 const code=String(station.external_station_id||'');
 const hold=require('./measurement-reference-verifier').EXCLUSIONS[code];
 if(entries===cached.stations&&hold)return {verified:false,reason:code==='1022640'?'MEASUREMENT_QUALITY_REVIEW_REQUIRED':'SPECIAL_STAGE_SCHEME_REVIEW_REQUIRED',note:hold};
 const entry=entries[code];
 if(!entry){if(entries===cached.stations&&cached.excluded?.[code])return {verified:false,reason:code==='1022640'?'MEASUREMENT_QUALITY_REVIEW_REQUIRED':'SPECIAL_STAGE_SCHEME_REVIEW_REQUIRED',note:cached.excluded[code]};return {verified:false,reason:'MEASUREMENT_REFERENCE_NOT_VERIFIED',note:'Official flood threshold compatibility has not been verified for this station.'};}
 const official=url=>{try{const u=new URL(url);return u.protocol==='https:'&&/(^|\.)(hrfco|wamis|nakdongriver|geumriver|yeongsanriver)\.go\.kr$/.test(u.hostname);}catch{return false;}};
 const at=String(latest?.observed_at||'');
 const identity=String(threshold?.reference_source||'').match(/(?:^|;)WAMIS:(\d+)(?:;|$)/)?.[1];
 const observationSource=latest?.observation_source_url||latest?.source_url;
 const sourceMatch=typeof observationSource==='string'&&Array.isArray(entry.observation_source_prefixes)&&entry.observation_source_prefixes.some(prefix=>observationSource.startsWith(prefix));
 const pointMatch=entry.scope!=='EXACT_OFFICIAL_OBSERVATION'||(entry.valid_from===entry.valid_until&&latest?.water_level!=null&&Math.abs(Number(latest.water_level)-entry.observed_value_m)<=.00051&&Number(threshold?.advisory_level_m??threshold?.caution_level_m)===entry.advisory_m&&Number(threshold?.warning_level_m??threshold?.alert_level_m)===entry.warning_m);
 const valid=pointMatch&&entry.station_code===code&&identity===code&&entry.review_status==='INDEPENDENTLY_VERIFIED'&&entry.reviewed_at&&
 sourceMatch&&threshold?.source_url===entry.threshold_document_url&&entry.observation_unit==='m'&&entry.threshold_unit==='m'&&entry.observation_reference&&entry.observation_reference===entry.threshold_reference&&
 official(entry.observation_document_url)&&official(entry.threshold_document_url)&&entry.observation_field==='wl'&&
 entry.valid_from&&entry.valid_until&&at>=entry.valid_from&&at<=entry.valid_until;
 return valid?{verified:true,reason:null,note:'Measurement and threshold reference independently verified.',reference:entry.observation_reference,evidence:entry}:
 {verified:false,reason:'MEASUREMENT_REFERENCE_INCOMPATIBLE',note:'Measurement and threshold identity, units, datum or effective dates are incompatible.'};
}
module.exports={compatibility};
