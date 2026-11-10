'use strict';
require('dotenv').config({quiet:true});
async function run(){
 const db=require('../db');
 try{
  const [[water]]=await db.execute('SELECT observed_at,water_level FROM water_readings WHERE station_id=? ORDER BY observed_at DESC LIMIT 1',[207]);
  const [[link]]=await db.execute('SELECT * FROM hr_rainfall_links WHERE station_id=?',[207]);
  const [rain]=await db.execute('SELECT observed_at,rainfall_mm FROM hr_rainfall_history WHERE station_code=? ORDER BY observed_at DESC LIMIT 40',[link.rainfall_station_code]);
  const [models]=await db.query("SELECT report FROM ml_model_versions WHERE prediction_type='WARNING_ISSUANCE' ORDER BY created_at DESC,model_version DESC LIMIT 1");
  const report=typeof models[0]?.report==='string'?JSON.parse(models[0].report):models[0]?.report;
  const {millis}=require('../monitoring-store');const origin=Math.floor(millis(water.observed_at)/3600000)*3600000;
  const present=new Set(rain.filter(r=>r.rainfall_mm!=null&&Number(r.rainfall_mm)>=0).map(r=>millis(r.observed_at)));
  const missing=Array.from({length:24},(_,i)=>origin-i*3600000).filter(t=>!present.has(t)).map(t=>new Date(t+9*3600000).toISOString().slice(0,19).replace('T',' '));
  console.log(JSON.stringify({port:process.env.PORT||5000,now:new Date().toISOString(),water,link,rain,missing,model:{status:report?.status,version:report?.model_version,reason:report?.reason,test:report?.test}},null,2));
 }finally{await db.end();}
}
if(require.main===module)run().catch(e=>{console.error(e.code||e.name);process.exitCode=1;});
