'use strict';
// Diagnostics, not a replacement for official flood evidence.
const fs = require('fs');
const path = require('path');
const STATE_FILE = path.join(__dirname, 'reports', 'wamis-live-sync-state.json');
const HOUR_MS = 3600000;
function summarize(assessments, state = {gauges:{}}, now = Date.now()) {
  const statuses = {fresh:0, stale:0, missing:0, verified_stage:0, missing_stage:0, no_recent_attempt:0, recent_attempt_but_old_observation:0};
  const problems=[];
  for (const gauge of assessments) {
    const id=String(gauge.station_id);
    const s=state.gauges?.[id] || {};
    const obs=gauge.observation_status;
    if (obs==='FRESH') statuses.fresh++;
    else if(obs==='STALE') statuses.stale++;
    else statuses.missing++;
    if (gauge.stage_evidence_verified) statuses.verified_stage++;
    else statuses.missing_stage++;
    const lastAttempt=Number(s.last_attempt_at_ms);
    const attemptedRecently=Number.isFinite(lastAttempt)&&lastAttempt>0&&now-lastAttempt<=2*HOUR_MS&&now>=lastAttempt;
    if(obs!=='FRESH') {
      if (attemptedRecently) statuses.recent_attempt_but_old_observation++;
      else statuses.no_recent_attempt++;
      problems.push({station_id:gauge.station_id,wamis_code:gauge.wamis_code,
        observation_status:obs, observed_at:gauge.observed_at,
        last_import_attempt_at:s.last_attempt_at_ms?new Date(s.last_attempt_at_ms).toISOString():null,
        importer_error:s.last_error || null,
        diagnosis:attemptedRecently?'RECENT_IMPORT_BUT_DATA_STALE_OR_MISSING':'IMPORT_NOT_ATTEMPTED_RECENTLY',
        stage_evidence_reason:gauge.stage_evidence_reason});
    }
  }
  return {success:true,generated_at:new Date(now).toISOString(),total_gauges:assessments.length,
    counts:statuses, import_check_interval_minutes:5,
    warning:'Freshness and verified stage criteria are separate requirements. No official risk is inferred from missing data.',
    stale_or_missing_gauges:problems};
}
function getState() {
  try {const raw=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));return raw?.gauges ? raw : {gauges:{}};}
  catch{return {gauges:{}};}
}
async function getReadiness(db) {
  const {getAssessments}=require('./verified-risk-evidence');
  return summarize(await getAssessments(db),getState());
}
module.exports={summarize,getReadiness};
