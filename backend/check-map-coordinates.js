require('dotenv').config();
const {located}=require('./geo');
async function check(db=require('./db')){const [rows]=await db.execute("SELECT DISTINCT s.* FROM stations s JOIN river_gauge_links l ON l.station_id=s.station_id WHERE l.verification_status='VERIFIED'");const missing=rows.filter(s=>!located(s));if(missing.length)throw Error('Missing map coordinates for station IDs: '+missing.map(s=>s.station_id).join(', '));console.log('All linked map gauges have coordinates:',rows.length);}
if(require.main===module){const db=require('./db');check(db).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());}
module.exports={check};
