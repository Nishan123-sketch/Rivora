const fs=require('node:fs/promises');const crypto=require('node:crypto');
const {importFile,importResponse,normalizeResponse}=require('./hrfco-warning-history');
const {fetchDay,validDate}=require('./hrfco-fetch-history');
const {millis}=require('./monitoring-store');
function validateCoverage(c){
 let url;try{url=new URL(c.source_url)}catch{throw Error('Coverage needs an official source URL')}
 if(!['api.hrfco.go.kr','www.hrfco.go.kr','hrfco.go.kr'].includes(url.hostname)||url.protocol!=='https:')throw Error('Coverage source must be HRFCO HTTPS');
 if(!/^\d{7,15}$/.test(String(c.station_code))||!Number.isFinite(millis(c.start_at))||!Number.isFinite(millis(c.end_at))||millis(c.start_at)>millis(c.end_at))throw Error('Invalid station coverage interval');
 if(!['PARTIAL','COMPLETE'].includes(c.status))throw Error('Unknown coverage status');
 if(c.status==='COMPLETE'&&(!['NONE','ADVISORY','WARNING'].includes(c.initial_state)||!c.evidence||c.reviewed_complete!==true))throw Error('Complete coverage requires reviewed evidence and a known initial state');
 if(c.status==='COMPLETE'&&millis(c.end_at)>Date.now())throw Error('Future warning coverage cannot be confirmed complete');
 return {...c,initial_state:c.status==='COMPLETE'?c.initial_state:null};
}
async function saveCoverage(db,manifest){
 let count=0;for(const raw of manifest.coverage||[]){const c=validateCoverage(raw);const id=crypto.createHash('sha256').update([c.station_code,c.start_at,c.end_at,c.status,c.source_url].join('|')).digest('hex');await db.execute('INSERT INTO ml_source_coverage(coverage_id,station_code,start_at,end_at,status,initial_state,source_url,evidence,checked_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE evidence=VALUES(evidence),initial_state=VALUES(initial_state),checked_at=VALUES(checked_at)',[id,String(c.station_code),c.start_at,c.end_at,c.status,c.initial_state,c.source_url,c.evidence||'Completeness has not been established']);count++;}return count;
}
async function partialCoverage(db,body,queryDate){
 const rows=normalizeResponse(body),byCode=new Map();for(const e of rows){if(!byCode.has(e.station_code))byCode.set(e.station_code,[]);byCode.get(e.station_code).push(e.issued_at);}
 return saveCoverage(db,{coverage:[...byCode].map(([station_code,times])=>({station_code,start_at:times.sort()[0],end_at:times.at(-1),status:'PARTIAL',source_url:'https://www.hrfco.go.kr/web/openapiPage/reference.do',evidence:`Authentic end-date response ${queryDate||'local verified capture'}; archive completeness and initial warning state are not established.`}))});
}
async function importHistoricalDays(days,{db=require('./db'),key=process.env.HRFCO_SERVICE_KEY,fetchImpl=fetch}={}){
 if(!days.length||days.length>60||days.some(d=>!validDate(d)))throw Error('Supply 1–60 valid YYYYMMDD end dates');
 const result=[];for(const date of [...new Set(days)])try{const body=await fetchDay(key,date,fetchImpl);const summary=await importResponse(db,body);await partialCoverage(db,body,date);result.push({date,status:'IMPORTED',...summary});}catch(e){result.push({date,status:'UNAVAILABLE',message:String(e.message).replaceAll(key||'\0','[KEY]').replace(/https?:\/\/\S+/g,'[HRFCO endpoint]').slice(0,180)});}return result;
}
async function main(){require('dotenv').config();const db=require('./db');try{
 await require('./advanced-ml-migrate').migrate(db);const args=process.argv.slice(2);
 if(args[0]==='--manifest'){const doc=JSON.parse(await fs.readFile(args[1],'utf8'));console.log({coverage_intervals:await saveCoverage(db,doc)});}
 else if(args[0]==='--fetch')console.log(JSON.stringify(await importHistoricalDays(args.slice(1),{db}),null,2));
 else{const file=args[0]||require('node:path').join(__dirname,'data/hrfco-20250719-historical.json');console.log(await importFile(db,file));const doc=JSON.parse(await fs.readFile(file,'utf8'));await partialCoverage(db,doc,doc.query_end_date);if(doc.coverage)console.log({coverage_intervals:await saveCoverage(db,doc)});}
 }finally{await db.end();}}
if(require.main===module)main().catch(e=>{console.error(e.code||e.message);process.exitCode=1});
module.exports={validateCoverage,saveCoverage,partialCoverage,importHistoricalDays};
