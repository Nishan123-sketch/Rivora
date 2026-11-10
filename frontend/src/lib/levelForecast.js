export function selectedLevelMetrics(horizon){const h=horizon?.holdout;return !h?null:h.chosen_method==='PERSISTENCE'?h.persistence:h.model||null;}
export function levelEvidenceLabel(horizon){return horizon?.validation_status==='RETROSPECTIVE_ACCEPTED_LEVEL_MODEL'?'Accepted retrospective level model':horizon?.validation_status==='EVALUATED_PERSISTENCE_BASELINE'?'Evaluated persistence baseline':'Evaluation unavailable';}
export function displayedLevelPrediction(horizon){const value=horizon?.predicted_level_m;return horizon?.forecast_status==='AVAILABLE'&&typeof value==='number'&&Number.isFinite(value)?value:null;}

export function levelAvailabilityLabel(station){
 if(station?.level_forecast_available)return 'Ready · '+(station.ready_horizons||[]).map(h=>h+'h').join(' / ');
 if(station?.level_output_available)return 'Baseline only';
 if(station?.data_status==='STALE'||station?.level_availability==='STALE_INPUT')return 'Reading out of date';
 return ({REFERENCE_REVIEW:'Reference review',TRAINING:'Training',MODEL_REJECTED:'Model rejected'})[station?.level_availability]||'Insufficient data';
}
