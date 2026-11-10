require('dotenv').config();
const {getWamis,normalizeStationInfo,BASE_URL}=require('./wamis-client');
const {matchRiver}=require('./river-catalog');
async function run(db=require('./db')){
 let imported=0;
 const [gauges]=await db.execute("SELECT * FROM stations WHERE data_source='RIVER_GAUGE' AND external_station_id IS NOT NULL"+(process.argv.includes('--all')?'':' AND (latitude IS NULL OR longitude IS NULL OR latitude<33 OR latitude>39.5 OR longitude<124 OR longitude>132)'));
 for(const gauge of gauges){
  const rows=await getWamis('wl_obsinfo',{obscd:gauge.external_station_id});
  for(const raw of rows){const s=normalizeStationInfo(raw);if(!s||s.code!==String(gauge.external_station_id))continue;const url=`${BASE_URL}/wkw/wl_obsinfo?obscd=${s.code}&output=json`;
   await db.execute("UPDATE stations SET latitude=?,longitude=?,coordinate_source_url=? WHERE data_source='RIVER_GAUGE' AND external_station_id=?",[s.lat,s.lon,url,s.code]);
   const river=matchRiver(s);if(river){const [[gauge]]=await db.execute("SELECT station_id FROM stations WHERE data_source='RIVER_GAUGE' AND external_station_id=?",[s.code]);if(gauge)await db.execute('INSERT INTO river_locations(river_id,latitude,longitude,source_url) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE latitude=VALUES(latitude),longitude=VALUES(longitude),source_url=VALUES(source_url)',[river.river_id,s.lat,s.lon,url]);}imported++;
  }
 }
 console.log('Sourced metadata processed:',imported);
}
if(require.main===module){const db=require('./db');run(db).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>db.end());}
module.exports={run};
