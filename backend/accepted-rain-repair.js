'use strict';
const fs=require('fs'),path=require('path');
function targets(training,network){const current=new Map((network?.stations||[]).map(s=>[Number(s.station_id),s]));return (training?.stations||[]).filter(s=>s.quality?.rainfall_source?.provider==='HRFCO'&&s.horizons?.some(h=>h.advanced_accepted===true&&h.model_features==='PAST_WATER_AND_POINT_RAINFALL')&&current.get(Number(s.station_id))?.horizons?.some(h=>h.fallback_reason==='MODEL_FEATURE_GAPS_EVALUATED_BASELINE_USED'||h.reason==='MISSING_POINT_IN_TIME_FEATURES'));}
async function repairAcceptedRain(db,training,network,{ensure=require('./hrfco-feature-history').ensureRecentRain}={}){
 const rows=[];for(const s of targets(training,network)){
  const expected=s.quality.rainfall_source;try{
   const [[link]]=await db.execute('SELECT rainfall_station_code,distance_km FROM hr_rainfall_links WHERE station_id=?',[s.station_id]);
   if(String(link?.rainfall_station_code)!==String(expected.code)||link?.distance_km==null||Number(link.distance_km)>25){rows.push({station_id:s.station_id,status:'SOURCE_MISMATCH_NOT_RELINKED'});continue;}
   const [[latest]]=await db.execute('SELECT observed_at FROM water_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 1',[s.station_id]);
   if(!latest){rows.push({station_id:s.station_id,status:'NO_CURRENT_WATER'});continue;}
   await ensure(db,s.station_id,latest.observed_at,{hours:72});rows.push({station_id:s.station_id,station_code:s.external_station_id,rainfall_station_code:String(expected.code),hours_requested:72,status:'REPAIR_CHECK_COMPLETED'});
  }catch(e){rows.push({station_id:s.station_id,status:'SOURCE_UNAVAILABLE',error_code:e.code||e.name});}
 }
 const result={generated_at:new Date().toISOString(),model_acceptance_changed:false,source_links_changed:false,targets:rows};const folder=path.join(__dirname,'reports/scientific-upgrade-20261109');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'accepted-rain-repair.json'),JSON.stringify(result,null,2));return result;
}
if(require.main===module){require('dotenv').config();const db=require('./db');const read=f=>JSON.parse(fs.readFileSync(path.join(__dirname,f),'utf8'));repairAcceptedRain(db,read('reports/level-upgrade/training.json'),read('reports/advanced-level-network.json')).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.code||e.name);process.exitCode=1}).finally(()=>db.end());}
module.exports={targets,repairAcceptedRain};
