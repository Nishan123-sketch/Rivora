'use strict';
require('dotenv').config({quiet:true});const fs=require('fs'),path=require('path'),crypto=require('crypto');
async function run(){const db=require('../db');try{
 const [[s]]=await db.execute("SELECT station_id,external_station_id FROM stations WHERE station_id=207 AND data_source='RIVER_GAUGE'");if(String(s?.external_station_id)!=='2201670')throw Error('TAEHWA_IDENTITY_MISMATCH');
 const end=new Date(Date.now()+9*3600000).toISOString().slice(0,10).replaceAll('-',''),start=new Date(Date.now()+9*3600000-3*86400000).toISOString().slice(0,10).replaceAll('-','');
 const source=await require('../hrfco-water-history').fetchHourlyHistory('2201670',start,end);let inserted=0;
 for(const r of source.records){const [result]=await db.execute('INSERT IGNORE INTO water_readings(station_id,observed_at,water_level,source_url) VALUES(?,?,?,?)',[207,r.observedAt,r.waterLevel,source.source_url]);inserted+=result.affectedRows;}
 const report={retrieved_at:new Date().toISOString(),station_id:207,station_code:'2201670',from:start,to:end,received:source.records.length,inserted,existing_rows_overwritten:false,source_url:source.source_url,records:source.records,records_sha256:crypto.createHash('sha256').update(JSON.stringify(source.records)).digest('hex')};const out=path.join(__dirname,'../reports/targeted-ml-repair-20261109/taehwa-water-recovery.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({received:report.received,inserted,existing_rows_overwritten:false}));
}finally{await db.end();}}
if(require.main===module)run().catch(e=>{console.error(e.code||e.name);process.exitCode=1;});
