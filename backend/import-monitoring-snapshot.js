'use strict';
require('dotenv').config();
const fs=require('fs'),zlib=require('zlib'),readline=require('readline'),path=require('path');
const tables=['stations','water_readings','weather_readings','aws_rainfall_readings','weather_forecasts','flood_thresholds','river_gauge_links','river_locations','station_rainfall_links','rainfall_stations','prediction_history','water_daily','rain_daily'];
async function restore(file,db=require('./db')){
 const [[{n}]]=await db.query('SELECT COUNT(*) AS n FROM stations');if(Number(n))throw Error('Snapshot import requires an empty stations table. Existing deployment preserved.');
 const lines=readline.createInterface({input:fs.createReadStream(file).pipe(zlib.createGunzip()),crlfDelay:Infinity});const c=await db.getConnection();let total=0;
 const columns=new Map(),optionalMetadata=new Set(['id','threshold_id','created_at','updated_at','imported_at']);
 try{await c.beginTransaction();for await(const line of lines){if(!line.trim())continue;const batch=JSON.parse(line);if(!tables.includes(batch.table)||!Array.isArray(batch.columns)||batch.columns.some(c=>!/^[a-z_]+$/.test(c))||!Array.isArray(batch.rows)||batch.rows.length>1000)throw Error('Invalid monitoring snapshot');if(!batch.rows.length)continue;
  if(!columns.has(batch.table)){const [fields]=await c.query('SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?',[batch.table]);columns.set(batch.table,new Set(fields.map(f=>f.COLUMN_NAME)));}
  const target=columns.get(batch.table),indices=batch.columns.map((name,i)=>target.has(name)?i:-1).filter(i=>i>=0);if(batch.columns.some(name=>!target.has(name)&&!optionalMetadata.has(name)))throw Error('Snapshot needs an unsupported schema column');
  await c.query(`INSERT INTO \`${batch.table}\` (${indices.map(i=>'`'+batch.columns[i]+'`').join(',')}) VALUES ?`,[batch.rows.map(row=>indices.map(i=>row[i]))]);total+=batch.rows.length;
 }await c.commit();console.log('Imported monitoring records:',total);}catch(e){await c.rollback();throw e;}finally{c.release();lines.close();}
}
if(require.main===module){const db=require('./db');restore(process.argv[2]||path.join(__dirname,'../database/monitoring-snapshot.jsonl.gz'),db).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>db.end());}
module.exports={restore,tables};
