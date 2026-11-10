require('dotenv').config();
const {nearest}=require('./geo');
async function run(db=require('./db')){
 const [gauges]=await db.execute("SELECT * FROM stations WHERE data_source='RIVER_GAUGE'");
 const [rain]=await db.execute(`SELECT r.aws_station_code AS external_station_id,r.gauge_name AS station_name,r.latitude,r.longitude,r.source_url AS coordinate_source_url,a.hourly_rainfall,a.observed_at FROM rainfall_stations r LEFT JOIN aws_rainfall_readings a ON a.aws_station_code=r.aws_station_code AND a.observed_at=(SELECT MAX(observed_at) FROM aws_rainfall_readings WHERE aws_station_code=r.aws_station_code)`);
 const current=rain.filter(r=>r.hourly_rainfall!==null&&r.hourly_rainfall!==undefined&&Number.isFinite(Number(r.hourly_rainfall))&&Number(r.hourly_rainfall)>=0&&Date.now()-Date.parse(String(r.observed_at).replace(' ','T')+'+09:00')>=0&&Date.now()-Date.parse(String(r.observed_at).replace(' ','T')+'+09:00')<=3*3600000);
 if(!rain.length)throw Error('AWS catalog empty. Run npm run import:aws-stations.');
 let count=0;
 for(const gauge of gauges){const closest=nearest(gauge,rain),available=nearest(gauge,current);const s=available?.distance_km<=30?available:closest;if(!s)continue;const [[old]]=await db.execute('SELECT verification_status FROM station_rainfall_links WHERE station_id=?',[gauge.station_id]);if(old?.verification_status==='VERIFIED')continue;
  await db.execute("INSERT INTO station_rainfall_links(station_id,aws_station_code,verification_status,reference_url,distance_km,gauge_name) VALUES(?,?,'AUTO_NEAREST',?,?,?) ON DUPLICATE KEY UPDATE aws_station_code=VALUES(aws_station_code),verification_status='AUTO_NEAREST',reference_url=VALUES(reference_url),distance_km=VALUES(distance_km),gauge_name=VALUES(gauge_name)",[gauge.station_id,s.external_station_id,s.coordinate_source_url,s.distance_km,s.station_name]);count++;
 }console.log('AUTO_NEAREST links:',count,'(manual VERIFIED links preserved)');
}
if(require.main===module){const db=require('./db');run(db).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>db.end());}
module.exports={run};
