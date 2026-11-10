'use strict';
// Fetch specific documented HRFCO flood-forecast issuance query dates.
// HRFCO_SERVICE_KEY belongs in .env. Never include the key in source, logs or ZIPs.
const {importResponse} = require('./hrfco-warning-history');

function validDate(text) {
  if (!/^\d{8}$/.test(String(text))) return false;
  const str=String(text),y=Number(str.slice(0,4)),m=Number(str.slice(4,6)),d=Number(str.slice(6,8));
  const parsed=new Date(Date.UTC(y,m-1,d));
  return parsed.getUTCFullYear()===y&&parsed.getUTCMonth()===m-1&&parsed.getUTCDate()===d;
}
async function fetchDay(key,date,fetchImpl=fetch) {
  if(!validDate(date)) throw new Error('Date must be YYYYMMDD, e.g. 20250719');
  key=configuredKey(key);
  if(!/^[0-9a-zA-Z-]{20,120}$/.test(key)) throw new Error('HRFCO_SERVICE_KEY missing or malformed');
  const url=`https://api.hrfco.go.kr/${encodeURIComponent(key)}/fldfct/list/${date}.json`;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`HRFCO HTTP ${response.status}`);
    const payload=await response.json();
    // 990 is an ambiguous service response, not a confirmed absence of warnings.
    if(!Array.isArray(payload?.content))throw new Error(`HRFCO no usable data for ${date} (service code ${String(payload?.code||'unknown')})`);
    return payload;
  } finally {clearTimeout(timeout);}
}
function configuredKey(value){
 const raw=String(value||'').trim();
 if(/^https?:/i.test(raw)){let url;try{url=new URL(raw)}catch{throw Error('Invalid HRFCO endpoint configuration')}
  if(url.protocol!=='https:'||url.hostname!=='api.hrfco.go.kr')throw Error('HRFCO endpoint must use the official HTTPS API host');
  const key=url.pathname.split('/').filter(Boolean)[0];if(!key)throw Error('HRFCO endpoint has no service key');return key;
 }return raw;
}
async function run(days, {key=process.env.HRFCO_SERVICE_KEY, db=require('./db'), fetchImpl=fetch}={}) {
  if(!days.length||days.length>60||days.some(d=>!validDate(d)))throw new Error('Supply 1–60 valid YYYYMMDD dates');
  const report=[];
  for(const date of [...new Set(days)]){
    try {
      const payload=await fetchDay(key,date,fetchImpl);
      const imported=await importResponse(db,payload);
      report.push({date,status:'IMPORTED',...imported});
    } catch(e) {
      // Do not print URLs or stack traces (which could contain the secret URL).
      report.push({date,status:'UNAVAILABLE',message:String(e.message).replaceAll(key||'\0','[KEY]').replace(/https?:\/\/\S+/g,'[HRFCO endpoint]').slice(0,180)});
    }
  }
  return report;
}
async function main() {
  require('dotenv').config();
  const db=require('./db');
  try {
    const report=await run(process.argv.slice(2),{db});
    console.log(JSON.stringify(report,null,2));
    if(report.every(item=>item.status!=='IMPORTED'))process.exitCode=1;
  }finally{await db.end();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={validDate,configuredKey,fetchDay,run};
