'use strict';
const {stageEvidence}=require('./verified-risk-evidence');
const {twoStageEvidence}=require('./official-two-stage');
const {measurementType}=require('./gauge-risk-safety');
function eligible(row){return row.data_source==='RIVER_GAUGE'&&measurementType(row.station_name)!=='POTENTIAL_DAM_OR_RESERVOIR'&&(stageEvidence(row).verified||!!twoStageEvidence(row,row));}
let cache=null,pending=null;
async function ids(){
 if(cache&&Date.now()-cache.at<60000)return cache.ids;
 if(pending)return pending;
 pending=(async()=>{const [rows]=await require('./db').query('SELECT s.station_id,s.station_name,s.external_station_id,s.data_source,t.interest_level_m,t.caution_level_m,t.alert_level_m,t.severe_level_m,t.advisory_level_m,t.warning_level_m,t.verification_status,t.source_url,t.verified_at,t.reference_source FROM stations s LEFT JOIN flood_thresholds t ON s.station_id=t.station_id');const ids=new Set(rows.filter(eligible).map(r=>String(r.station_id)));cache={at:Date.now(),ids,visible:new Set(rows.filter(r=>r.data_source==='KMA'||ids.has(String(r.station_id))).map(r=>String(r.station_id)))};return ids;})().finally(()=>pending=null);return pending;
}
async function publicStations(rows){const allowed=await ids();return rows.filter(s=>s.data_source==='KMA'||allowed.has(String(s.station_id)));}
module.exports={eligible,ids,publicStations,visibleIds:async()=>{await ids();return cache.visible;}};
