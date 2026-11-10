'use strict';
// Bounded extension of the existing collectors. Never relabel a different rain gauge.
require('dotenv').config({quiet:true});
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {fetchRain}=require('../hrfco-feature-history');
const {getWamisForHistory,wamisHour,BASE_URL}=require('../wamis-client');
const OUT=path.join(__dirname,'../reports/scientific-followup-20261109');
const STORM={from:'2025-07-16 00:00:00',to:'2025-07-20 23:00:00',source:'https://www.kma.go.kr/kma/news/press.jsp?mode=view&num=1194509'};
function rainValue(value){if(!['number','string'].includes(typeof value)||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}
function parseAws(text,tm,code){
 // Require the documented RN_HR1 schema and exact hour offset; no daily/cumulative substitution.
 if(!text.includes('RN_HR1')||!text.includes('RN_HR1_MI'))throw Error('UNVERIFIED_KMA_RN_SCHEMA');
 const result=[];
 for(const line of text.split(/\r?\n/)){const c=line.trim().split(/\s+/);if(c[0]!==tm||c[1]!==String(code)||c.length<14)continue;const value=rainValue(c[6]);if(c[7]==='-60'&&value!==null)result.push({at:`${tm.slice(0,4)}-${tm.slice(4,6)}-${tm.slice(6,8)} ${tm.slice(8,10)}:00:00`,value});}
 return result;
}
function requestedRows(rows,gaps){return rows.filter(r=>rainValue(r.value)!==null&&r.at<'2026-01-01 00:00:00'&&gaps.some(g=>r.at>=g.from&&r.at<=g.to));}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
async function run(){
 const db=require('../db');fs.mkdirSync(OUT,{recursive:true});
 const stormCompletion=process.argv.includes('--complete-storm');const supplement=process.argv.includes('--supplement')||stormCompletion;const reportFile=path.join(OUT,stormCompletion?'rainfall-storm-completion.json':supplement?'rainfall-recovery-supplement.json':'rainfall-recovery-results.json');
 const gaps=JSON.parse(fs.readFileSync(path.join(__dirname,'../reports/scientific-continuation-20261109/after-repair/authentic-data-gaps.json'),'utf8')).filter(g=>g.data_type==='POINT_RAINFALL');
 const training=JSON.parse(fs.readFileSync(path.join(__dirname,'../reports/level-upgrade/training.json'),'utf8'));
 const promising=new Set(training.stations.filter(s=>s.horizons?.some(h=>h.advanced_accepted)).map(s=>String(s.external_station_id)));
 const cohort=new Set(JSON.parse(fs.readFileSync(path.join(__dirname,'../reports/scientific-continuation-20261109/level-development-results.json'),'utf8')).results.map(r=>r.station_code));
 const report={created_at:new Date().toISOString(),maximum_gauge_days:supplement?3:12,existing_rows_overwritten:false,independent_storm_evidence:STORM,cohort_rain_gap_overlap:gaps.filter(g=>cohort.has(g.station_code)).length,priority:[],requests:[],aws_requests:[]};
 try{
  const [events]=await db.query("SELECT station_code,issued_at,severity,bulletin_no,observed_at,observed_level_m FROM hr_flood_warning_history WHERE action='ISSUE' AND issued_at<'2026-01-01' ORDER BY issued_at");
  const [links]=await db.query("SELECT l.station_id,l.aws_station_code,l.verification_status,r.source_url FROM station_rainfall_links l JOIN rainfall_stations r ON r.aws_station_code=l.aws_station_code WHERE l.verification_status IN ('VERIFIED','AUTO_NEAREST')");
  const candidates=[];
  for(const gap of gaps){
   const matched=events.filter(e=>String(e.station_code)===gap.station_code&&e.issued_at>=gap.from&&e.issued_at<=gap.to);
   const storm=gap.from<=STORM.to&&gap.to>=STORM.from;
   const score=(promising.has(gap.station_code)?100:0)+(matched.length?50:0)+(storm?20:0);
   report.priority.push({...gap,score,promising_accepted_level_station:promising.has(gap.station_code),official_warning_issues_in_gap:matched.length,documented_storm_overlap:storm});
   const days=[...new Set(matched.map(e=>String(e.issued_at).slice(0,10)))];
   if(storm)days.unshift((gap.from>STORM.from?gap.from:'2025-07-17 00:00:00').slice(0,10));
   if(promising.has(gap.station_code)&&!days.length)days.push(gap.from.slice(0,10));
   for(const day of [...new Set(days)].slice(0,2))candidates.push({gap,day,score,evidence:matched.filter(e=>String(e.issued_at).startsWith(day))});
  }
  report.priority.sort((a,b)=>b.score-a.score);candidates.sort((a,b)=>b.score-a.score);
  const unique=new Map();for(const c of candidates){const key=c.gap.rain_station_code+':'+c.day;if(!unique.has(key))unique.set(key,c);}
  const previous=supplement?JSON.parse(fs.readFileSync(path.join(OUT,'rainfall-recovery-results.json'),'utf8')).requests:[];
  let chosen=[...unique.values()].filter(c=>!supplement||!previous.some(r=>r.rain_station_code===c.gap.rain_station_code&&r.day===c.day&&r.status!=='UNAVAILABLE')).slice(0,report.maximum_gauge_days);
  if(stormCompletion){
   const recovered=[...previous,...JSON.parse(fs.readFileSync(path.join(OUT,'rainfall-recovery-supplement.json'),'utf8')).requests].filter(r=>r.inserted>0&&r.day>='2025-07-16'&&r.day<='2025-07-20');
   const source=recovered[0];if(!source)throw Error('NO_VERIFIED_STORM_RECOVERY');
   const gap=gaps.find(g=>g.rain_station_code===source.rain_station_code&&g.from<=STORM.to&&g.to>=STORM.from);chosen=[];
   for(const day of ['2025-07-16','2025-07-17','2025-07-18','2025-07-19','2025-07-20']){
    if(!recovered.some(r=>r.rain_station_code===source.rain_station_code&&r.day===day))chosen.push({gap,day,score:70,evidence:events.filter(e=>String(e.station_code)===gap.station_code&&String(e.issued_at).startsWith(day))});
   }
   chosen=chosen.slice(0,report.maximum_gauge_days);
  }
  report.acquisition_plan=chosen.map(c=>({station_code:c.gap.station_code,rain_station_code:c.gap.rain_station_code,day:c.day,score:c.score,official_events:c.evidence}));
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  for(const {gap,day} of chosen){
   const sameGaugeGaps=gaps.filter(g=>g.rain_station_code===gap.rain_station_code);const compact=day.replaceAll('-','');const row={rain_station_code:gap.rain_station_code,day,station_code:gap.station_code};
   try{
    let rows=[];try{rows=await fetchRain(gap.rain_station_code,compact,compact);}catch(error){row.hrfco_failure=error.code||error.name;}let source='https://www.hrfco.go.kr/web/openapiPage/reference.do#rainfall';
    rows=requestedRows(rows,sameGaugeGaps);
    if(!rows.length){try{
     const raw=await getWamisForHistory('rf_hrdata',{obscd:gap.rain_station_code,startdt:compact,enddt:compact},15000);
     if(!Array.isArray(raw))throw Error('WAMIS_RAIN_UNUSABLE');
     rows=requestedRows(raw.map(r=>({at:wamisHour(r.ymdh),value:rainValue(r.rf)})).filter(r=>r.at&&r.value!==null),sameGaugeGaps);source=`${BASE_URL}/wkw/rf_hrdata?obscd=${gap.rain_station_code}&startdt=${compact}&enddt=${compact}&output=json`;
    }catch(error){row.wamis_fallback=error.code||error.name;}}
    let inserted=0;for(const r of rows){const [result]=await db.execute('INSERT IGNORE INTO hr_rainfall_history(station_code,observed_at,rainfall_mm,source_url) VALUES(?,?,?,?)',[gap.rain_station_code,r.at,r.value,source]);inserted+=result.affectedRows;}
    Object.assign(row,{status:rows.length?'AUTHENTIC_MATCHING_GAUGE_RECORDS':'SOURCE_GAP_REMAINS',inserted,records:rows,source_url:source,records_sha256:hash(rows)});
   }catch(error){Object.assign(row,{status:'UNAVAILABLE',reason:error.code||error.name});}
   report.requests.push(row);
   // AWS observations remain under their own station code and table; they never fill HRFCO-gauge gaps.
   const link=links.find(l=>Number(l.station_id)===gap.station_id);
   if(link&&!supplement&&report.aws_requests.length<4){
    const tm=compact+'1200',aws={station_code:String(link.aws_station_code),at:day+' 12:00:00',river_station_code:gap.station_code,link_status:link.verification_status,role:'NEARBY_POINT_CONTEXT_NOT_UPSTREAM_OR_SAME_HRFCO_GAUGE'};
    try{
     const [[existing]]=await db.execute('SELECT hourly_rainfall FROM aws_rainfall_readings WHERE aws_station_code=? AND observed_at=?',[link.aws_station_code,aws.at]);
     if(existing)aws.status='EXISTING_ROW_PRESERVED';
     else{
      const url=new URL('https://apihub.kma.go.kr/api/typ01/url/awsh.php');url.search=new URLSearchParams({var:'RN',tm,stn:String(link.aws_station_code),help:'1',authKey:process.env.KMA_API_KEY||''});
      const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('KMA_HTTP_'+response.status);
      const text=require('iconv-lite').decode(Buffer.from(await response.arrayBuffer()),'cp949');const rows=parseAws(text,tm,link.aws_station_code);
      let inserted=0;for(const r of rows){const [result]=await db.execute('INSERT IGNORE INTO aws_rainfall_readings(aws_station_code,observed_at,hourly_rainfall,daily_rainfall) VALUES(?,?,?,NULL)',[link.aws_station_code,r.at,r.value]);inserted+=result.affectedRows;}
      Object.assign(aws,{status:rows.length?'AUTHENTIC_AWS_CONTEXT':'SOURCE_GAP_REMAINS',inserted,records:rows,response_sha256:crypto.createHash('sha256').update(text).digest('hex'),source_url:'https://apihub.kma.go.kr/api/typ01/url/awsh.php',requested_tm:tm});
     }
    }catch(error){aws.status='UNAVAILABLE';aws.reason=error.code||error.name;}
    report.aws_requests.push(aws);
   }
   fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({code:row.rain_station_code,day,status:row.status,inserted:row.inserted||0}));
  }
 }finally{await db.end();}
 return report;
}
if(require.main===module)run().catch(error=>{console.error('PRIORITY_RAIN_RECOVERY_FAILED',error.code||error.name);process.exitCode=1;});
module.exports={rainValue,parseAws,requestedRows};
