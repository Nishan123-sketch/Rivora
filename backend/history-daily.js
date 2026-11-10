'use strict';
function coverage(rows,start,end){
 const valid=rows.filter(r=>r.water_level!==null&&r.water_level!==undefined);
 const times=valid.map(r=>r.observed_at).sort();
 const expected=Math.round((Date.parse(end.slice(0,10))-Date.parse(start.slice(0,10)))/3600000)+24;
 const count=valid.reduce((sum,r)=>sum+Number(r.samples??1),0);
 return {first_observed_at:times[0]||null,last_observed_at:times.at(-1)||null,observed_hours:count,expected_hours:expected,percent:Math.min(100,100*count/expected)};
}
async function refreshDaily(db=require('./db')){
 await db.query(`INSERT INTO water_daily(station_id,day,min_level,max_level,mean_level,samples) SELECT station_id,DATE(observed_at),MIN(water_level),MAX(water_level),AVG(water_level),COUNT(water_level) FROM water_readings WHERE observed_at>=UTC_TIMESTAMP()+INTERVAL 9 HOUR-INTERVAL 400 DAY GROUP BY station_id,DATE(observed_at) ON DUPLICATE KEY UPDATE min_level=VALUES(min_level),max_level=VALUES(max_level),mean_level=VALUES(mean_level),samples=VALUES(samples)`);
 await db.query(`INSERT INTO rain_daily(aws_station_code,day,total_mm,samples) SELECT aws_station_code,DATE(observed_at),SUM(hourly_rainfall),COUNT(hourly_rainfall) FROM aws_rainfall_readings WHERE observed_at>=UTC_TIMESTAMP()+INTERVAL 9 HOUR-INTERVAL 400 DAY GROUP BY aws_station_code,DATE(observed_at) ON DUPLICATE KEY UPDATE total_mm=VALUES(total_mm),samples=VALUES(samples)`);
}
async function dailyHistory(id,start,end,db){
 const all=id==='all',params=all?[start.slice(0,10),end.slice(0,10)]:[start.slice(0,10),end.slice(0,10),id];
 // An explicit bound produces an actionable error, never a partial chart.
 const [water]=await db.execute(`SELECT station_id,CONCAT(day,' 00:00:00') AS observed_at,min_level,max_level,mean_level AS water_level,samples FROM water_daily WHERE day BETWEEN ? AND ?${all?'':' AND station_id=?'} ORDER BY day,station_id LIMIT 100001`,params);
 const [rainfall]=await db.execute(`SELECT s.station_id,CONCAT(a.day,' 00:00:00') AS observed_at,a.total_mm AS hourly_rainfall,a.samples FROM rain_daily a JOIN stations s ON s.data_source='KMA' AND BINARY s.external_station_id=BINARY a.aws_station_code OR EXISTS(SELECT 1 FROM station_rainfall_links l WHERE l.station_id=s.station_id AND BINARY l.aws_station_code=BINARY a.aws_station_code AND l.verification_status IN ('VERIFIED','AUTO_NEAREST')) WHERE a.day BETWEEN ? AND ?${all?'':' AND s.station_id=?'} ORDER BY a.day,s.station_id LIMIT 100001`,params);
 const [risks]=await db.execute(`SELECT station_id,MIN(assessed_at) AS assessed_at,MAX(risk_score) AS risk_score,SUBSTRING_INDEX(GROUP_CONCAT(risk_level ORDER BY FIELD(risk_level,'Unknown','Low','Moderate','High','Severe') DESC),',',1) AS risk_level,'Daily maximum recorded assessment' AS reason FROM risk_assessments WHERE assessed_at BETWEEN ? AND ?${all?'':' AND station_id=?'} GROUP BY station_id,DATE(assessed_at) ORDER BY MIN(assessed_at) LIMIT 100001`,all?[start,end]:[start,end,id]);
 if([water,rainfall,risks].some(r=>r.length>100000))throw Error('Too many stations. Select one station to view the complete range.');
 return {success:true,start,end,water,rainfall,risks,weather:[],predictions:[],granularity:'daily',truncated:false,coverage:all?null:coverage(water,start,end),message:'Daily mean water level and daily rainfall sum; incomplete rainfall days remain labelled by sample count. Run npm run aggregate:daily after importing history.'};
}
if(require.main===module){require('dotenv').config();const db=require('./db');refreshDaily(db).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>db.end());}
module.exports={coverage,dailyHistory,refreshDaily};
