'use strict';
require('dotenv').config({quiet:true});
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ROOT=path.join(__dirname,'..'),OUT=path.join(ROOT,'reports/targeted-ml-repair-20261109');
const read=name=>JSON.parse(fs.readFileSync(path.join(ROOT,name),'utf8'));
function equivalent(a,b,label){
 if(typeof a==='number'&&typeof b==='number'){assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-12*Math.max(1,Math.abs(a),Math.abs(b)),label);return;}
 if(a&&b&&typeof a==='object'&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),label);for(const key of Object.keys(a))equivalent(a[key],b[key],label+'.'+key);return;}
 assert.deepEqual(a,b,label);
}
async function main(){
 fs.mkdirSync(OUT,{recursive:true});const base='http://127.0.0.1:'+String(process.env.PORT||5000);
 async function get(route){const r=await fetch(base+route,{signal:AbortSignal.timeout(60000)}),j=await r.json();assert.equal(r.ok,true,route);assert.equal(j.success,true,route);return j.data;}
 const saved=read('reports/advanced-warning-validation.json'),training=read('reports/level-upgrade/training.json');
 const overview=await get('/api/ml/overview?refresh=1'),c=overview.counts,rows=overview.stations,asOf=Date.parse(overview.snapshot.as_of),ids=new Set(rows.map(r=>String(r.station_id)));
 assert.equal(c.gauges,ids.size);assert.equal(c.gauges,rows.length);
 assert.equal(c.level_outputs,rows.filter(r=>r.level_output_available).length);
 assert.equal(c.active_advanced_stations,rows.filter(r=>r.level_forecast_available).length);
 assert.equal(c.active_advanced_stations+c.baseline_only,c.level_outputs);
 assert.equal(c.level_outputs+c.unavailable,c.gauges);
 const pairs=new Set(),acceptedIds=new Set();
 for(const station of training.stations)if(ids.has(String(station.station_id)))for(const h of station.horizons||[])if(h.advanced_accepted){pairs.add(station.station_id+':'+h.horizon_hours);acceptedIds.add(station.station_id);}
 assert.equal(c.accepted_model_stations,acceptedIds.size);assert.equal(c.accepted_station_horizon_models,pairs.size);
 for(const row of rows)if(row.level_output_available)for(const h of row.level_horizons.filter(h=>['READY','BASELINE_ONLY'].includes(h.status)))assert.ok(Date.parse(h.valid_at.replace(' ','T')+'+09:00')>asOf,'Expired output counted available');
 assert.equal(overview.warning_evidence.model_version,saved.model_version);
 assert.equal(overview.warning_evidence.evaluated_at,saved.generated_at);
 assert.equal(overview.warning_evidence.acceptance.precision,saved.test.precision);
 assert.equal(overview.warning_evidence.acceptance.brier_score,saved.test.brier_score);
 if(saved.status!=='VALIDATED_WARNING_FORECAST'){assert.equal(c.validated_warning_models,0);assert.equal(overview.warning_evidence.probability_enabled,false);}
 const selected=[207,rows.find(r=>r.level_availability==='BASELINE_ONLY')?.station_id,rows.find(r=>!r.level_output_available)?.station_id,rows.find(r=>r.level_forecast_available&&r.station_id!==207)?.station_id,3009].filter(Boolean);
 const details=[];
 for(const id of [...new Set(selected)]){const d=await get('/api/ml/stations/'+id+'?refresh=1');assert.equal(Number(d.station.station_id),Number(id));assert.equal(d.warning_evidence.model_version,saved.model_version);if(!d.warning_evidence.probability_enabled)assert.equal(d.warning_prediction.probability,null);if(id===207)assert.ok(d.level_forecasts.every(h=>h.forecast_status==='AVAILABLE'),'Taehwa lost a forecast');for(const h of d.level_forecasts)if(h.forecast_status==='AVAILABLE')assert.ok(typeof h.predicted_level_m==='number'&&Number.isFinite(h.predicted_level_m));details.push({station:d.station,features:d.features.quality,warning_status:d.warning_prediction.status,probability:d.warning_prediction.probability,level_forecasts:d.level_forecasts.map(h=>({horizon_hours:h.horizon_hours,status:h.forecast_status,advanced_accepted:h.advanced_accepted,model:h.model_name,reason:h.reason,valid_at:h.valid_at}))});}
 const db=require('../db');let dbEvidence;
 try{const [versions]=await db.query("SELECT report FROM ml_model_versions WHERE prediction_type='WARNING_ISSUANCE' ORDER BY created_at DESC,model_version DESC LIMIT 1");const r=typeof versions[0].report==='string'?JSON.parse(versions[0].report):versions[0].report;for(const key of ['model_version','status','generated_at','test','baseline_climatology','validation_blocks'])equivalent(r[key],saved[key],key+' differs between saved file and production DB');dbEvidence={model_version:r.model_version,status:r.status,saved_evidence_matches:true,numeric_serialization_relative_tolerance:1e-12};
 const recovered=read('reports/targeted-ml-repair-20261109/event-rain-recovery.json');let verified=0;for(const entry of recovered.results)for(const record of entry.records||[]){const [[value]]=await db.execute('SELECT rainfall_mm FROM hr_rainfall_history WHERE station_code=? AND observed_at=?',[entry.observation_station_code,record.at]);assert.ok(value);assert.ok(Math.abs(Number(value.rainfall_mm)-record.value)<.0001);verified++;}dbEvidence.recovered_rainfall_records_verified=verified;
 }finally{await db.end();}
 const proxy=await fetch('http://localhost:5173/api/ml/overview?refresh=1',{signal:AbortSignal.timeout(60000)});assert.ok(proxy.ok);
 fs.writeFileSync(path.join(OUT,'api-overview.json'),JSON.stringify(overview,null,2));
 const report={checked_at:new Date().toISOString(),snapshot:overview.snapshot,counts:c,reconciliation_passed:true,warning_evidence:overview.warning_evidence,production_database:dbEvidence,stations:details,frontend_proxy_status:proxy.status};
 fs.writeFileSync(path.join(OUT,'api-integration.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({counts:c,snapshot:overview.snapshot,stations_checked:details.length,production_evidence_matches:true,proxy:proxy.status}));
}
main().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
