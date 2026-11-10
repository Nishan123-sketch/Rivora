'use strict';
require('dotenv').config({quiet:true});
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.join(__dirname,'..'),OUT=path.join(ROOT,'reports/targeted-ml-repair-20261109');
const {fetchRain}=require('../hrfco-feature-history');
async function run(){
 const manifest=JSON.parse(fs.readFileSync(path.join(OUT,'eligible-warning-data-requests.json'),'utf8'));
 // Two exact event-relevant windows: known-working gauge and one older training event.
 const selected=manifest.filter(r=>r.provider==='HRFCO'&&['10224020','10144170'].includes(r.observation_station_code)).slice(0,2);
 const db=require('../db'),results=[];
 try{for(const request of selected){const row={...request,started_at:new Date().toISOString()};
  try{
   if(request.to>='2026-01-01'||request.missing_hours>30)throw Error('OUTSIDE_BOUNDED_DEVELOPMENT_SCOPE');
   const rows=await fetchRain(request.observation_station_code,request.from.slice(0,10).replaceAll('-',''),request.to.slice(0,10).replaceAll('-',''));
   const genuine=rows.filter(r=>r.at>=request.from&&r.at<=request.to&&typeof r.value==='number'&&Number.isFinite(r.value)&&r.value>=0);
   let inserted=0;for(const r of genuine){const [result]=await db.execute('INSERT IGNORE INTO hr_rainfall_history(station_code,observed_at,rainfall_mm,source_url) VALUES(?,?,?,?)',[request.observation_station_code,r.at,r.value,request.official_source_url]);inserted+=result.affectedRows;}
   Object.assign(row,{status:genuine.length?'AUTHENTIC_RECORDS_FOUND':'SOURCE_GAP_REMAINS',inserted,records:genuine,records_sha256:crypto.createHash('sha256').update(JSON.stringify(genuine)).digest('hex')});
  }catch(error){row.status='UNAVAILABLE';row.reason=error.code||error.name;}
  results.push(row);fs.writeFileSync(path.join(OUT,'event-rain-recovery.json'),JSON.stringify({maximum_windows:2,existing_rows_overwritten:false,results},null,2));console.log(JSON.stringify({code:row.observation_station_code,from:row.from,to:row.to,status:row.status,inserted:row.inserted||0}));
 }}finally{await db.end();}
}
if(require.main===module)run().catch(error=>{console.error(error.code||error.name);process.exitCode=1;});
