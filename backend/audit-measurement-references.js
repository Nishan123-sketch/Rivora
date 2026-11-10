'use strict';
// Read-only database audit. Writes a report file, never modifies observations.
require('dotenv').config();
async function audit(db=require('./db'),now=Date.now()){
 const [records]=await db.query(`SELECT t.*,s.station_id,s.station_name,s.external_station_id,s.data_source,
 w.water_level,DATE_FORMAT(w.observed_at,'%Y-%m-%d %H:%i:%s') observed_at,w.source_url observation_source_url
 FROM stations s LEFT JOIN flood_thresholds t ON t.station_id=s.station_id LEFT JOIN water_readings w ON w.reading_id=(SELECT reading_id FROM water_readings WHERE station_id=s.station_id ORDER BY observed_at DESC,reading_id DESC LIMIT 1) WHERE s.data_source='RIVER_GAUGE'`);
 const [duplicates]=await db.query("SELECT external_station_id,COUNT(*) count FROM stations WHERE data_source='RIVER_GAUGE' GROUP BY external_station_id HAVING COUNT(*)>1");
 const [links]=await db.query("SELECT station_id,river_id,verification_status,reference_url,source_river_name FROM river_gauge_links WHERE verification_status='VERIFIED'");
 const eligible=require('./official-station-policy').eligible,{evaluate,time}=require('./risk-engine');
 const rows=records.filter(eligible).map(r=>{const assessment=evaluate({station:r,latest:r,threshold:r,now});const flags=[];
  if(!assessment.measurement_compatibility?.verified)flags.push('REFERENCE_REQUIRES_INDEPENDENT_REVIEW');
  if(!r.observation_source_url)flags.push('OBSERVATION_SOURCE_NOT_STORED');
  if(!r.observed_at||!Number.isFinite(time(r.observed_at)))flags.push('OBSERVATION_TIME_MISSING_OR_INVALID');
  if(['STALE','MISSING','FUTURE_TIMESTAMP'].includes(assessment.data_status))flags.push(assessment.data_status);
  const mappings=links.filter(l=>l.station_id===r.station_id);if(mappings.length!==1)flags.push('RIVER_MAPPING_REQUIRES_REVIEW');
  if(r.water_level!=null&&Number(r.water_level)>=Number(r.warning_level_m??r.alert_level_m))flags.push('LARGE_RELATIVE_TO_THRESHOLD_REVIEW_REFERENCE_NOT_VALUE_REJECTION');
  return {station_id:r.station_id,station_code:r.external_station_id,name:r.station_name,river_links:mappings,water_level_m:r.water_level,observed_at:r.observed_at,observation_source_url:r.observation_source_url,published_thresholds:{caution_m:r.advisory_level_m??r.caution_level_m,alert_m:r.warning_level_m??r.alert_level_m,source_url:r.source_url,legacy_reference:r.reference_source},measurement_compatibility:assessment.measurement_compatibility||null,level:assessment.level,data_status:assessment.data_status,flags};});
 const [duplicateObservations]=await db.query('SELECT station_id,observed_at,COUNT(*) count,COUNT(DISTINCT water_level) distinct_values FROM water_readings GROUP BY station_id,observed_at HAVING COUNT(*)>1 LIMIT 100');
 const excluded=records.filter(r=>!eligible(r)).map(r=>({station_id:r.station_id,station_code:r.external_station_id,reason:require('./gauge-risk-safety').measurementType(r.station_name)==='POTENTIAL_DAM_OR_RESERVOIR'?'EXCLUDED_DAM_OR_RESERVOIR':r.threshold_id==null?'MISSING_THRESHOLDS':'UNVERIFIED_THRESHOLDS_OR_IDENTITY'}));
 const categories={Low:0,Moderate:0,High:0,'Not assessed':0};for(const row of rows)categories[['High','Severe'].includes(row.level)?'High':['Low','Moderate'].includes(row.level)?row.level:'Not assessed']++;
 const count=flag=>rows.filter(r=>r.flags.includes(flag)).length;
 return {generated_at:new Date(now).toISOString(),scope:'All catalog-eligible published-threshold river gauges; not an independently verified national station total',summary:{stations:rows.length,independently_verified_compatible:rows.filter(r=>r.measurement_compatibility?.verified).length,flagged_for_review:rows.filter(r=>r.flags.length).length,not_assessed:rows.filter(r=>!r.level).length,low:rows.filter(r=>r.level==='Low').length,moderate:rows.filter(r=>r.level==='Moderate').length,high_or_severe:rows.filter(r=>['High','Severe'].includes(r.level)).length,duplicate_station_codes:duplicates.length,missing_observation_provenance:count('OBSERVATION_SOURCE_NOT_STORED'),stale:count('STALE'),missing:count('MISSING'),future:count('FUTURE_TIMESTAMP'),river_mapping_flags:count('RIVER_MAPPING_REQUIRES_REVIEW'),large_relative_values:count('LARGE_RELATIVE_TO_THRESHOLD_REVIEW_REFERENCE_NOT_VALUE_REJECTION')},category_totals:{total:rows.length,...categories,sum:Object.values(categories).reduce((a,b)=>a+b,0),consistent:rows.length===Object.values(categories).reduce((a,b)=>a+b,0)},registered_river_gauges:records.length,excluded,duplicate_observations:duplicateObservations,duplicates,stations:rows};
}
if(require.main===module){const db=require('./db');audit(db).then(report=>{const fs=require('fs'),path=require('path');const file=process.argv[2]||path.join(__dirname,'reports/measurement-reference-audit.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));}).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>db.end());}
module.exports={audit};
