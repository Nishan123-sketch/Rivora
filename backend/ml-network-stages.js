// Read the verified stage-only overview in bulk. Full station analysis stays separate.
async function snapshot(db=require('./db'),now=Date.now()){
 const [records]=await db.query(`SELECT s.station_id,s.station_name,s.external_station_id,s.data_source,
 w.observed_at,w.water_level,w.source_url AS observation_source_url,t.interest_level_m,t.caution_level_m,t.alert_level_m,t.severe_level_m,
 t.advisory_level_m,t.warning_level_m,t.verification_status,t.verified_at,t.source_url,t.reference_source,
 l.river_id FROM stations s JOIN flood_thresholds t ON t.station_id=s.station_id
 LEFT JOIN (SELECT station_id,MAX(observed_at) observed_at FROM water_readings GROUP BY station_id) lw ON lw.station_id=s.station_id LEFT JOIN water_readings w ON w.station_id=lw.station_id AND w.observed_at=lw.observed_at
 LEFT JOIN river_gauge_links l ON l.station_id=s.station_id AND l.verification_status='VERIFIED'
 WHERE s.data_source='RIVER_GAUGE' AND t.verification_status='VERIFIED'`);
 const catalog=require('./river-network-registry').getCatalog(),{evaluate}=require('./risk-engine');
 const seen=new Set();return records.filter(r=>{if(seen.has(r.station_id))return false;seen.add(r.station_id);return true;}).map(r=>{const river=catalog.find(c=>c.river_id===r.river_id);return {...r,...evaluate({station:r,latest:r,threshold:r,now}),river_name_en:river?.name_en,river_name_ko:river?.name_ko};}).filter(r=>r.threshold_verified);
}
module.exports={snapshot};
