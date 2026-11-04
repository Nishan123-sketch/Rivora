const express=require('express');
const pool=require('./db');
const {analyzeRiver}=require('./river-analysis');
const {evaluateGaugeSafety}=require('./gauge-risk-safety');
const {getCatalog}=require('./river-network-registry');
const router=express.Router();

// Identity-verified gauge mapping; verified thresholds are tracked independently.
router.get('/river-catalog',async(req,res)=>{
 try{
  const [linked]=await pool.execute(`
   SELECT l.river_id,l.verification_status,l.reference_url,l.verified_at,
     l.source_river_name,l.last_verified_observation_at,
     s.station_id,s.station_name,s.external_station_id,s.latitude,s.longitude,
     DATE_FORMAT(w.observed_at,'%Y-%m-%d %H:%i:%s') AS latest_observed_at,
     w.water_level AS latest_water_level
   FROM river_gauge_links l
   JOIN stations s ON s.station_id=l.station_id AND s.data_source='RIVER_GAUGE'
   LEFT JOIN water_readings w ON w.reading_id=(
     SELECT w2.reading_id FROM water_readings w2 WHERE w2.station_id=s.station_id
     ORDER BY w2.observed_at DESC LIMIT 1)
   WHERE l.verification_status='VERIFIED'
   ORDER BY s.station_name`);
  const allCatalog=getCatalog();
  const data=allCatalog.map(r=>({...r,stations:linked.filter(s=>s.river_id===r.river_id).map(s=>({
    station_id:s.station_id,station_name:s.station_name,external_station_id:s.external_station_id,
    latitude:s.latitude,longitude:s.longitude,reference_url:s.reference_url,
    verification_status:s.verification_status,source_river_name:s.source_river_name,
    latest_observed_at:s.latest_observed_at,latest_water_level:s.latest_water_level
  }))}));
  const monitored=data.filter(r=>r.stations.length>0);
  const includeUnlinked=req.query.include_unlinked==='true';
  const visible=includeUnlinked?data:monitored;
  const gauges=linked.length;
  const monitored_rivers=monitored.length;
  return res.json({success:true,count:visible.length,candidate_rivers:allCatalog.length,unlinked_rivers:data.length-monitored_rivers,monitored_rivers,gauges,
    caveat:'A verified gauge identity is not a verified flood-warning threshold.',data:visible});
 }catch(e){console.error('Catalog query failed',e);return res.status(503).json({success:false,message:'River catalog unavailable. Run npm run rivers:setup to initialize mapping.'});}
});

router.get('/rivers',async(req,res)=>{
 try{const [data]=await pool.execute(`SELECT station_id,station_name,latitude,longitude,data_source,external_station_id FROM stations WHERE data_source='RIVER_GAUGE' ORDER BY station_name`);
  res.json({success:true,count:data.length,data});}
 catch(e){console.error(e);res.status(500).json({success:false,message:'Could not load river gauges'});}
});

async function findStation(stationId){
 const [rows]=await pool.execute(`SELECT station_id,station_name,data_source,external_station_id FROM stations WHERE station_id=? AND data_source='RIVER_GAUGE' LIMIT 1`,[stationId]);
 return rows[0]||null;
}
router.get('/rivers/:stationId/risk',async(req,res)=>{
 try{
  const id=Number(req.params.stationId);
  if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({success:false,message:'Invalid station ID'});
  const station=await findStation(id);
  if(!station)return res.status(404).json({success:false,message:'River gauge not found'});
  const a=await analyzeRiver(station.external_station_id);
  const available=a.status==='OBSERVATION_ANALYSIS';
  const safety=evaluateGaugeSafety({station,analysis:a});
  const assessmentAllowed=safety.stage_comparison_allowed;
  return res.json({success:true,station,observation_available:available,
   latest_observation:available?{observed_at:a.latest_observed_at,water_level_m:a.latest_water_level}:null,
   data_freshness:a.data_freshness||null,
   river_trend:{trend:a.trend||'UNKNOWN',previous_hour_available:a.changes?.['1h']!=null,
     previous_hour_change_m:a.changes?.['1h']??null,changes:a.changes||null},
   flood_thresholds:a.thresholds||null,risk_level:assessmentAllowed?(a.risk_level??null):null,
   gauge_data_quality:safety,
   assessment_status:assessmentAllowed?'ASSESSED':'NOT_ASSESSED',assessment_type:assessmentAllowed?(a.assessment_type||null):null,
   official_warning_issued:null,
   message:assessmentAllowed?'Stage comparison uses verified station-specific thresholds; no official warning feed is checked.':'Official flood-stage risk withheld: stale or unsuitable observation, or unverified gauge-specific thresholds.',
   limitations:['Flood warning thresholds must be verified separately for each gauge.',
    'Water-level trends and rainfall alone do not establish a flood-risk category.',
    'No official flood-warning feed is connected. Experimental model output is not an official warning.']});
 }catch(e){console.error('River risk error:',e);res.status(500).json({success:false,message:'River risk analysis unavailable'});}
});

router.get('/rivers/:stationId/history',async(req,res)=>{
 try{
  const id=Number(req.params.stationId),hours=Number(req.query.hours??24);
  if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({success:false,message:'Invalid station ID'});
  if(!Number.isSafeInteger(hours)||hours<1||hours>168)return res.status(400).json({success:false,message:'Hours must be 1–168'});
  const station=await findStation(id);
  if(!station)return res.status(404).json({success:false,message:'River gauge not found'});
  const [rows]=await pool.execute(`SELECT reading_id,station_id,DATE_FORMAT(observed_at,'%Y-%m-%d %H:%i:%s') AS observed_at,
   water_level,flow_rate FROM water_readings WHERE station_id=?
   AND observed_at >= DATE_SUB(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),INTERVAL ? HOUR)
   ORDER BY observed_at ASC`,[id,hours]);
  res.json({success:true,station,requested_hours:hours,count:rows.length,readings:rows});
 }catch(e){console.error('River history error:',e);res.status(500).json({success:false,message:'River history unavailable'});}
});
module.exports=router;
