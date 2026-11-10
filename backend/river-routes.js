const express=require('express');
const pool=require('./db');
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
   LEFT JOIN (SELECT station_id,MAX(observed_at) AS observed_at FROM water_readings GROUP BY station_id) latest ON latest.station_id=s.station_id
   LEFT JOIN water_readings w ON w.station_id=latest.station_id AND w.observed_at=latest.observed_at
   WHERE l.verification_status='VERIFIED'
   ORDER BY s.station_name`);
  const eligible=await require('./official-station-policy').ids();
  const officialLinked=linked.filter(s=>eligible.has(String(s.station_id)));
  const allCatalog=getCatalog();
  const data=allCatalog.map(r=>({...r,stations:officialLinked.filter(s=>s.river_id===r.river_id).map(s=>({
    station_id:s.station_id,station_name:s.station_name,external_station_id:s.external_station_id,
    latitude:s.latitude,longitude:s.longitude,reference_url:s.reference_url,
    verification_status:s.verification_status,source_river_name:s.source_river_name,
    latest_observed_at:s.latest_observed_at,latest_water_level:s.latest_water_level
  }))}));
  const monitored=data.filter(r=>r.stations.length>0);
  const visible=monitored;
  const gauges=officialLinked.length;
  const monitored_rivers=monitored.length;
  return res.json({success:true,count:visible.length,candidate_rivers:monitored_rivers,unlinked_rivers:0,excluded_rivers:data.length-monitored_rivers,monitored_rivers,gauges,
    caveat:'Only gauges with verified official thresholds are included. A comparison is not an issued warning.',data:visible});
 }catch(e){console.error('Catalog query failed',e);return res.status(503).json({success:false,message:'River catalog unavailable. Run npm run rivers:setup to initialize mapping.'});}
});

router.get('/rivers',async(req,res)=>{
 try{const [data]=await pool.execute(`SELECT station_id,station_name,latitude,longitude,data_source,external_station_id FROM stations WHERE data_source='RIVER_GAUGE' ORDER BY station_name`);
  const allowed=await require('./official-station-policy').ids();const visible=data.filter(s=>allowed.has(String(s.station_id)));res.json({success:true,count:visible.length,data:visible});}
 catch(e){console.error(e);res.status(500).json({success:false,message:'Could not load river gauges'});}
});

async function findStation(stationId){
 const [rows]=await pool.execute(`SELECT station_id,station_name,data_source,external_station_id FROM stations WHERE station_id=? AND data_source='RIVER_GAUGE' LIMIT 1`,[stationId]);
 return rows[0]||null;
}
router.get('/rivers/:stationId/risk',async(req,res)=>{
 const id=Number(req.params.stationId);if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({message:'Invalid station ID'});
 try{const r=(await require('./risk-engine').getUnified()).find(s=>Number(s.station_id)===id);if(!r)return res.status(404).json({message:'River gauge not found'});return res.json({success:true,station:r,unified_risk:r,risk_level:r.level,risk_score:r.score,risk_basis:r.basis,assessment_status:r.level?'ASSESSED':'NOT_ASSESSED',observation_available:r.water_level!==null,latest_observation:{water_level_m:r.water_level,observed_at:r.observed_at},river_trend:{trend:r.rise_1h===null?'UNKNOWN':r.rise_1h>0?'RISING':r.rise_1h<0?'FALLING':'UNCHANGED',changes:{'1h':r.rise_1h,'3h':r.rise_3h,'6h':r.rise_6h}},message:r.reasons.join(', '),official_warning_issued:null});}catch{return res.status(503).json({message:'Unified risk unavailable'});}
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
