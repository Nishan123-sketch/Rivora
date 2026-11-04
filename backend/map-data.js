const pool=require('./db');const {catalog}=require('./river-catalog');const {summaries}=require('./monitoring-store');
async function mapData(){const stations=await summaries();const [links]=await pool.query("SELECT river_id,station_id FROM river_gauge_links WHERE verification_status='VERIFIED'");const [locations]=await pool.query('SELECT * FROM river_locations');
 return catalog.map(r=>{const gauges=links.filter(l=>l.river_id===r.river_id).map(l=>stations.find(s=>String(s.station_id)===String(l.station_id))).filter(Boolean);const location=locations.find(l=>l.river_id===r.river_id);return {...r,stations:gauges,location:location||null};});}
module.exports={mapData};
