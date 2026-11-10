'use strict';
// Read-only prospective availability check. Never scores or reuses exposed outcomes.
require('dotenv').config({quiet:true});
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const OUT=path.join(__dirname,'../reports/warning-model-improvement-20261109');
async function run(){
 fs.mkdirSync(OUT,{recursive:true});const policyPath=path.join(OUT,'prospective-evaluation-plan.json');
 const plan={version:'warning-prospective-20261109-v1',registered_at:new Date().toISOString(),
  evaluation_origins_from_kst:'2026-11-10 00:00:00',excluded:'All earlier outcomes, including the already-inspected 2026 final test',
  candidate_selection:'Highest selection-block AP in the predeclared development comparison, then reject unless its threshold and Brier checks pass; do not switch candidates using threshold-block outcomes',
  freezing:'Freeze artifact checksum, feature schema, station context and calibration/threshold parameters before the first evaluated forecast. No prospective forecasts may be reconstructed retrospectively.',
  target:'New official advisory/warning issuance in (t,t+3h] from confirmed NONE state',
  label_evidence:'Complete official archive coverage for the full target window; missing archive coverage is unknown, never negative',
  stop_rule:'Score once after the first 10 distinct completed future warning-storm proxy groups (72h separation/closure), with at least 10 positive issuance events. Do not inspect prospective accuracy before this rule is met.',
  precision_minimum:.2,event_detection_rate_minimum:.8,brier_rule:'Strictly lower than frozen training-climatology Brier on the same evaluation rows',
  minimum_calibration_events:2,minimum_threshold_events:2,minimum_test_positive_events:10,minimum_station_training_events:5,minimum_station_test_events:5,
  probability_release:'Never enabled from development results or availability counts; requires all independent and per-station acceptance checks'};
 if(!fs.existsSync(policyPath))fs.writeFileSync(policyPath,JSON.stringify(plan,null,2));
 const frozen=JSON.parse(fs.readFileSync(policyPath,'utf8'));const db=require('../db');
 try{
  const [[water]]=await db.query('SELECT MAX(observed_at) AS latest_at FROM water_readings');
  const [[coverage]]=await db.query("SELECT MAX(end_at) AS latest_at FROM ml_source_coverage WHERE status='COMPLETE'");
  const [versions]=await db.query("SELECT model_version,status FROM ml_model_versions WHERE prediction_type='WARNING_ISSUANCE' ORDER BY created_at DESC,model_version DESC LIMIT 1");
  const start=Date.parse(frozen.evaluation_origins_from_kst.replace(' ','T')+'+09:00');
  const decisionPath=path.join(OUT,'promotion-decision.json');const decision=fs.existsSync(decisionPath)?JSON.parse(fs.readFileSync(decisionPath,'utf8')):null;
  const blockers=[];if(!decision?.development_gate_passed)blockers.push('NO_DEVELOPMENT_CANDIDATE_QUALIFIED');if(Date.now()<start)blockers.push('UNTOUCHED_FUTURE_PERIOD_NOT_STARTED');
  const report={checked_at:new Date().toISOString(),prospective_start_kst:frozen.evaluation_origins_from_kst,
   status:'NOT_READY_FOR_INDEPENDENT_EVALUATION',blockers,development_candidate:decision?.chosen_by_selection_ap||null,
   latest_water_observation:water.latest_at,latest_confirmed_archive_coverage:coverage.latest_at,
   current_production_model:versions[0]||null,production_report_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../reports/advanced-warning-validation.json'))).digest('hex'),
   final_test_scored:false,production_written:false,probability_enabled:false};
  fs.writeFileSync(path.join(OUT,'independent-evaluation-readiness.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await db.end();}
}
if(require.main===module)run().catch(e=>{console.error(e.code||e.name);process.exitCode=1;});
