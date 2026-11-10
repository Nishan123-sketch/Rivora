'use strict';
// Bounded, read-only entitlement probe. Never log credential-bearing URLs.
require('dotenv').config({quiet:true});
const fs=require('fs'),path=require('path');
const {fetchHourlyHistory}=require('../hrfco-water-history');
const {fetchRain}=require('../hrfco-feature-history');
const {getWamisForHistory,mapReadings}=require('../wamis-client');
async function main(){
 const report={created_at:new Date().toISOString(),database_writes:false,large_download_authorized:false,probes:[],configured:{hrfco:Boolean(process.env.HRFCO_SERVICE_KEY),kma_key_present:Boolean(process.env.KMA_API_KEY),kma_dedicated_key_variable_present:Boolean(process.env.KMA_API_HUB_KEY||process.env.KMA_AUTH_KEY)}};
 for(const [provider,request] of [
  ['HRFCO_WATER',()=>fetchHourlyHistory('3004690','20250131','20250131')],
  ['HRFCO_RAIN',()=>fetchRain('30064020','20241201','20241201')],
  ['WAMIS_WATER',()=>getWamisForHistory('wl_hrdata',{obscd:'3004690',startdt:'20250131',enddt:'20250131'},15000)]
 ]){
  try{const payload=await request();const rows=provider==='HRFCO_WATER'?payload.records:provider==='HRFCO_RAIN'?payload:mapReadings(payload);report.probes.push({provider,status:rows.length?'RECORDS_RETURNED':'NO_USABLE_RECORDS',records:rows.length,bulk_entitlement_confirmed:false});}
  catch(error){report.probes.push({provider,status:'UNAVAILABLE',reason:error.code||(/^[A-Z][A-Z0-9_]+$/.test(error.message||'')?error.message:error.name)});}
 }
 if(process.argv.includes('--kma-historical')){
  const url=new URL('https://apihub.kma.go.kr/api/typ01/url/awsh.php');
  url.search=new URLSearchParams({var:'RN',tm:'202507171200',stn:'152',help:'1',authKey:process.env.KMA_API_KEY||''});
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(20000)});const body=require('iconv-lite').decode(Buffer.from(await response.arrayBuffer()),'cp949');
   const safe=body.replaceAll(process.env.KMA_API_KEY||'\0','[REDACTED]');
   const rows=safe.split(/\r?\n/).filter(line=>/^\s*202507171200\s+152\s/.test(line));
   report.historical_aws_access=rows.length?'CONFIRMED_FOR_TESTED_REQUEST':'NOT_CONFIRMED';report.probes.push({provider:'KMA_AWS_HISTORICAL_RN',http_status:response.status,station:'152',tm:'202507171200',matched_rows:rows.length,status:rows.length?'RECORDS_RETURNED':'NO_MATCHING_OBSERVATIONS',response:safe.slice(0,15000)});
  }catch(error){report.probes.push({provider:'KMA_AWS_HISTORICAL_RN',status:'UNAVAILABLE',reason:error.code||error.name});}
 }
 const out=path.join(__dirname,process.argv.includes('--kma-historical')?'../reports/scientific-followup-20261109/archive-access-probe.json':'../reports/scientific-continuation-20261109/archive-access-probe.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
if(require.main===module)main().catch(()=>{console.error('ARCHIVE_PROBE_FAILED');process.exitCode=1;});
