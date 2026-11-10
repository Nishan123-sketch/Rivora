const pool=require('./db');const {getCatalog}=require('./river-network-registry');const {summaries}=require('./monitoring-store');
async function mapData(){const allowed=await require('./official-station-policy').ids();const stations=(await summaries()).filter(s=>allowed.has(String(s.station_id)));const [links]=await pool.query("SELECT river_id,station_id FROM river_gauge_links WHERE verification_status='VERIFIED'");const [locations]=await pool.query('SELECT * FROM river_locations');
 return getCatalog().map(r=>{const gauges=links.filter(l=>l.river_id===r.river_id).map(l=>stations.find(s=>String(s.station_id)===String(l.station_id))).filter(Boolean);const location=locations.find(l=>l.river_id===r.river_id);return {...r,stations:gauges,location:location||null};}).filter(r=>r.stations.length>0);}
function compactMap(rows){return rows.map(r=>({...r,stations:r.stations.map(s=>Object.fromEntries(['station_id','station_name','external_station_id','latitude','longitude','water_level','water_observed_at','data_status','risk_level','rainfall','rainfall_observed_at'].map(k=>[k,s[k]])))}));}
// Search metadata only: no observations, prediction artifacts or history queries.
async function mapCatalog(db=pool,readCatalog=require('./monitoring-locations').catalog){const rows=await readCatalog(db);const grouped=new Map();for(const s of rows){if(!grouped.has(s.river_id))grouped.set(s.river_id,{river_id:s.river_id,name_en:s.river_name,name_ko:s.river_name_ko,stations:[]});grouped.get(s.river_id).stations.push({station_id:s.station_id,station_name:s.station_name,external_station_id:s.station_code,province:s.province,district:s.district});}return [...grouped.values()];}
async function stationDetails(id,{db=pool,allowedIds=require('./official-station-policy').ids,evaluate=require('./risk-engine').evaluate,officialWarning=require('./unified-alerts').officialWarning}={}){
 if(!Number.isSafeInteger(id)||id<=0||!(await allowedIds()).has(String(id)))return null;
 const [[station]]=await db.execute("SELECT station_id,station_name,external_station_id,data_source,latitude,longitude,coordinate_source_url FROM stations WHERE station_id=? AND data_source='RIVER_GAUGE'",[id]);if(!station)return null;
 const [[latest]]=await db.execute('SELECT water_level,observed_at,source_url FROM water_readings WHERE station_id=? ORDER BY observed_at DESC,reading_id DESC LIMIT 1',[id]);
 const [[threshold]]=await db.execute('SELECT * FROM flood_thresholds WHERE station_id=?',[id]);
 const coordinate_verified=require('./monitoring-locations').verifiedCoordinates(station),value=latest?.water_level;
 const water_level=value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
 let assessment=evaluate({station,latest,threshold});
 try{const warning=await officialWarning(db,id);if(warning)assessment={...assessment,level:warning.status==='WARNING'?'High':'Moderate',official_warning:true,display_source:'Official warning',official_warning_status:warning.status};}catch{/* Unavailable official coverage cannot imply an absence of warnings. */}
 return {...station,latitude:coordinate_verified?Number(station.latitude):null,longitude:coordinate_verified?Number(station.longitude):null,coordinate_verified,water_level,observed_at:latest?.observed_at||null,observation_source_url:latest?.source_url||null,assessment:{...assessment,water_level}};
}
module.exports={mapData,compactMap,mapCatalog,stationDetails};
