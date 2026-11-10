'use strict';
// Repair only short, explicitly audited pre-2026 gaps; preserve all existing rows.
require('dotenv').config({quiet:true});
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {fetchHourlyHistory}=require('../hrfco-water-history');
const {fetchRain}=require('../hrfco-feature-history');
const {getWamisForHistory,mapReadings,BASE_URL}=require('../wamis-client');
const out=path.join(__dirname,'../reports/scientific-continuation-20261109');
function within(rows,gap){return rows.filter(r=>r.at>=gap.from&&r.at<=gap.to&&r.at<'2026-01-01 00:00:00'&&Number.isFinite(r.value));}
async function main(){
 const db=require('../db');const gaps=JSON.parse(fs.readFileSync(path.join(out,'authentic-data-gaps.json'),'utf8')).filter(g=>g.missing_hours<=24).slice(0,8);
 const report={started_at:new Date().toISOString(),existing_observations_modified:false,maximum_gap_hours:24,maximum_gaps:8,results:[]};
 try{for(const gap of gaps){
  const row={station_id:gap.station_id,station_code:gap.station_code,data_type:gap.data_type,from:gap.from,to:gap.to};
  try{
   const [[station]]=await db.execute("SELECT external_station_id FROM stations WHERE station_id=? AND data_source='RIVER_GAUGE'",[gap.station_id]);if(String(station?.external_station_id)!==gap.station_code)throw Error('STATION_IDENTITY_MISMATCH');
   const day=gap.from.slice(0,10).replaceAll('-','');let rows,source;
   if(gap.data_type==='WATER_LEVEL'){
    const data=await fetchHourlyHistory(gap.station_code,day,day);rows=within(data.records.map(r=>({at:r.observedAt,value:r.waterLevel})),gap);source=data.source_url;
    if(!rows.length){const raw=await getWamisForHistory('wl_hrdata',{obscd:gap.station_code,startdt:day,enddt:day},15000);rows=within(mapReadings(raw).map(r=>({at:r.observedAt,value:r.waterLevel})),gap);source=`${BASE_URL}/wkw/wl_hrdata?obscd=${gap.station_code}&startdt=${day}&enddt=${day}&output=json`;}
   }else{rows=within(await fetchRain(gap.rain_station_code,day,day),gap);source='https://www.hrfco.go.kr/web/openapiPage/reference.do#rainfall';}
   let inserted=0;
   for(const r of rows){let result;
    if(gap.data_type==='WATER_LEVEL') [result]=await db.execute('INSERT IGNORE INTO water_readings(station_id,observed_at,water_level,source_url) VALUES(?,?,?,?)',[gap.station_id,r.at,r.value,source]);
    else [result]=await db.execute('INSERT IGNORE INTO hr_rainfall_history(station_code,observed_at,rainfall_mm,source_url) VALUES(?,?,?,?)',[gap.rain_station_code,r.at,r.value,source]);
    inserted+=result.affectedRows;
   }
   Object.assign(row,{status:rows.length?'AUTHENTIC_RECORDS_FOUND':'SOURCE_GAP_REMAINS',received:rows.length,inserted,source_url:source,response_records_sha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),records:rows});
  }catch(error){Object.assign(row,{status:'UNAVAILABLE',reason:error.code||(/^[A-Z][A-Z0-9_]+$/.test(error.message||'')?error.message:error.name)});}
  report.results.push(row);fs.writeFileSync(path.join(out,'gap-repair-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(row));
 }}finally{await db.end();}
}
if(require.main===module)main().catch(()=>{console.error('GAP_REPAIR_FAILED');process.exitCode=1;});
module.exports={within};
