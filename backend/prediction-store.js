const pool=require('./db');
// Persist legacy endpoint results before sending them to the browser.
async function saveLegacyPrediction(stationId,result){
 const predictions=[result.prediction,result.rainfall_model?.prediction].filter(p=>p&&p.predicted_water_level_m!=null);
 for(const p of predictions){
  const observed=p.observed_at||p.input_observation_time||result.latest_observation?.observed_at;
  const target=p.target_time||p.predicted_for;
  if(!observed||!target)continue;
  await pool.execute(`INSERT INTO prediction_history(station_id,observed_at,valid_at,generated_at,model_version,predicted_water_level,status,reason) VALUES(?,?,?,UTC_TIMESTAMP()+INTERVAL 9 HOUR,?,?,'LEGACY_LEVEL','Experimental level prediction; not flood probability') ON DUPLICATE KEY UPDATE prediction_id=LAST_INSERT_ID(prediction_id)`,[stationId,observed,target,'legacy-'+String(p.model||'ridge').slice(0,80),p.predicted_water_level_m]);
 }
 return result;
}
module.exports={saveLegacyPrediction};
