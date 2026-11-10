'use strict';
// Dataset readiness only. Never report prediction accuracy from a partial archive.
function summarize(rows){
  const positive=rows.filter(row=>row.action==='ISSUE');
  const exactMatch=positive.filter(row=>row.station_id!=null);
  const enoughWater=exactMatch.filter(row=>Number(row.prior_hourly_readings)>=18);
  return {historical_warning_records:rows.length,
    warning_issuances:positive.length,
    matched_wamis_warning_issuances:exactMatch.length,
    issuances_with_minimum_prior_water_levels:enoughWater.length,
    sufficient_for_flood_model_validation:false,
    historical_archive_complete:false,
    calibrated_three_hour_flood_probability_available:false,
    missing_requirements:[
      'Archive must cover defined negative observation periods as well as positive warnings.',
      'Match pre-warning weather observations and archival forecasts without future-data leakage.',
      'Run chronological storm-separated holdout evaluation and probability calibration.'
    ],
    note:'Counts alone do not measure predictive accuracy; 2025 notices may predate local WAMIS history.'};
}
async function audit(db=require('./db')){
  try {
    const [rows]=await db.query(`SELECT h.station_code,h.action,h.issued_at,s.station_id,
      (SELECT COUNT(*) FROM water_readings w WHERE w.station_id=s.station_id
       AND w.observed_at >= DATE_SUB(h.issued_at, INTERVAL 24 HOUR)
       AND w.observed_at < h.issued_at AND w.water_level IS NOT NULL) AS prior_hourly_readings
      FROM hr_flood_warning_history h
      LEFT JOIN stations s ON s.external_station_id=h.station_code
        AND s.data_source='RIVER_GAUGE'
      WHERE h.action='ISSUE'`);
    return summarize(rows);
  } catch(error) {
    if(error.code==='ER_NO_SUCH_TABLE')return {...summarize([]),status:'HRFCO_HISTORY_NOT_IMPORTED'};
    throw error;
  }
}
if(require.main===module){
  require('dotenv').config();
  const db=require('./db');
  audit(db).then(result=>console.log(JSON.stringify(result,null,2))).catch(e=>{
    console.error('Validation readiness:',e.code||e.message);process.exitCode=1;
  }).finally(()=>db.end());
}
module.exports={summarize,audit};
