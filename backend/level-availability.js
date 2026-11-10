'use strict';
const {normalizeHorizon}=require('./level-artifact-service');
function horizonState(h,now=Date.now()){
 const normalized=normalizeHorizon(h,now);const available=normalized.forecast_status==='AVAILABLE';
 const accepted=available&&h.advanced_accepted===true;
 // The artifact's explicit acceptance flag is authoritative; names alone are not evidence.
 return {...normalized,availability:accepted?'READY':available?'BASELINE_ONLY':/REFERENCE|MEASUREMENT/.test(normalized.reason||'')?'REFERENCE_REVIEW':/REJECT/.test(normalized.reason||'')?'MODEL_REJECTED':/STALE|FUTURE|EXPIRED/.test(normalized.reason||'')?'STALE_INPUT':'INSUFFICIENT_DATA',accepted_advanced:accepted};
}
function stationState(station,now=Date.now()){
 const horizons=(station?.horizons||[]).map(h=>horizonState(h,now));
 const ready=horizons.filter(h=>h.accepted_advanced),baseline=horizons.filter(h=>h.availability==='BASELINE_ONLY');
 return {status:ready.length?'READY':baseline.length?'BASELINE_ONLY':horizons.find(h=>h.availability==='REFERENCE_REVIEW')?'REFERENCE_REVIEW':horizons.find(h=>h.availability==='STALE_INPUT')?'STALE_INPUT':horizons.find(h=>h.availability==='MODEL_REJECTED')?'MODEL_REJECTED':'INSUFFICIENT_DATA',horizons,ready_horizons:ready.map(h=>h.horizon_hours),baseline_horizons:baseline.map(h=>h.horizon_hours),reason:ready.length||baseline.length?null:station?.reason||horizons.find(h=>h.reason)?.reason||'NO_TRAINED_ARTIFACT'};
}
function warningEvidence(report){
 const blocks=report?.validation_blocks||{},minimum=2,finite=v=>typeof v==='number'&&Number.isFinite(v);
 const acceptance=report?.test?{precision:report.test.precision,minimum_precision:.2,precision_passed:finite(report.test.precision)&&report.test.precision>=.2,event_recall:report.test.event_detection_rate,minimum_event_recall:.8,event_recall_passed:finite(report.test.event_detection_rate)&&report.test.event_detection_rate>=.8,brier_score:report.test.brier_score,baseline_brier_score:report.baseline_climatology?.brier_score,brier_passed:finite(report.test.brier_score)&&finite(report.baseline_climatology?.brier_score)&&report.test.brier_score<report.baseline_climatology.brier_score}:null;
 const failures=[];
 if(!acceptance?.precision_passed)failures.push('Precision below the required 20% or evidence unavailable.');
 if(!acceptance?.event_recall_passed)failures.push('Event recall below the required 80% or evidence unavailable.');
 if(!acceptance?.brier_passed)failures.push('Brier score does not beat the frozen training-climatology baseline or evidence is unavailable.');
 if((blocks.calibration?.events??0)<minimum||(blocks.thresholds?.events??0)<minimum)failures.push('Insufficient separate calibration or threshold-selection events.');
 if((report?.test?.positive_warning_events??0)<10||!report?.calibration_method)failures.push('Independent test-event or calibration evidence is incomplete.');
 const probability_enabled=report?.status==='VALIDATED_WARNING_FORECAST'&&report?.probability_available===true&&failures.length===0;
 return {scope:'NETWORK_WIDE_WARNING_ISSUANCE',status:report?.status||'MODEL_UNAVAILABLE',reason:report?.reason||null,model_version:report?.model_version||null,evaluated_at:report?.generated_at||null,independent_evaluation_status:report?.status==='INDEPENDENT_TEST_ACCEPTANCE_FAILED'?'FAILED':probability_enabled?'PASSED_REPORTED_ACCEPTANCE_CHECKS':'NOT_VALIDATED',probability_enabled,disabled_reasons:probability_enabled?[]:failures.length?failures:[report?.reason||'No accepted production warning model is available.'],requirements:{minimum_events_per_validation_block:minimum,calibration_events:blocks.calibration?.events??null,calibration_additional_events:blocks.calibration?Math.max(0,minimum-blocks.calibration.events):null,threshold_events:blocks.thresholds?.events??null,threshold_additional_events:blocks.thresholds?Math.max(0,minimum-blocks.thresholds.events):null},acceptance,blocks,split_counts:report?.split_counts||null,qualification:'Event deficits are necessary minima, not sufficient acceptance. Both label classes, storm purge, complete official coverage, feature windows and all accuracy/calibration gates must pass; test events stay isolated.'};
}
function acceptanceCounts(training,stations){
 const scope=new Set(stations.map(s=>String(s.station_id))),pairs=new Set(),ids=new Set();
 for(const station of training?.stations||[]){if(!scope.has(String(station.station_id)))continue;for(const h of station.horizons||[])if(h.advanced_accepted===true){pairs.add(String(station.station_id)+':'+h.horizon_hours);ids.add(String(station.station_id));}}
 return {accepted_model_stations:training?ids.size:null,accepted_station_horizon_models:training?pairs.size:null,accepted_station_ids:[...ids].sort(),source_generated_at:training?.generated_at||null,source_available:!!training};
}
function overviewCounts(rows,coverage,training,warning){const accepted=acceptanceCounts(training,rows);const active=rows.filter(s=>s.level_forecast_available).length,outputs=rows.filter(s=>s.level_output_available).length;return {gauges:rows.length,accepted_model_stations:accepted.accepted_model_stations,accepted_station_horizon_models:accepted.accepted_station_horizon_models,active_advanced_stations:active,level_forecasts:active,level_outputs:outputs,baseline_only:rows.filter(s=>s.level_output_available&&!s.level_forecast_available).length,unavailable:rows.filter(s=>!s.level_output_available).length,active_advanced_horizons:rows.filter(s=>s.level_forecast_available).reduce((n,s)=>n+s.ready_horizons.length,0),ready_horizons:Object.fromEntries([1,3,6].map(h=>[h,rows.filter(s=>s.level_forecast_available&&s.ready_horizons.includes(h)).length])),experimental_grades:rows.filter(s=>s.experimental_available).length,validated_warning_models:warning.probability_enabled?1:0,warning_forecast_stations:rows.filter(s=>s.warning_forecast_available).length,official_warning_coverage:coverageCount(rows,coverage)};}
function coverageCount(stations,coverage){const codes=new Set(coverage.map(c=>String(c.station_code)));return stations.filter(s=>codes.has(String(s.station_code))).length;}
function repairSummary(){try{const r=JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'reports/availability-repair/history-repair.json'),'utf8'));return {stations_checked:r.stations.length,target_stations:r.targets.length,verified_rows_added:r.inserted,completed_at:r.completed_at||null,stopped_reason:r.stopped_reason||null};}catch{return null}}
module.exports={horizonState,stationState,warningEvidence,acceptanceCounts,overviewCounts,coverageCount,repairSummary};
