'use strict';
// Read-only public-data conversation replay. No private user credentials or database writes.
const fs=require('fs'),path=require('path');
const base=process.env.ASSIST_EVAL_URL||'http://127.0.0.1:5001';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('Evaluation endpoint must be local');
const cases=[
 ['How many rivers are monitored in Ulsan?',d=>Number.isInteger(d.river_count)],
 ['Which ones?',d=>d.tools?.includes('prior_verified_river_catalog')],
 ['Find Seonchon 2 Bridge.',d=>d.station_ids?.includes(2912)],
 ['What is its level?',d=>d.station_ids?.includes(2912)&&d.evidence?.some(e=>e.metric==='water_level')],
 ['What about its rainfall?',d=>d.station_ids?.includes(2912)&&d.evidence?.some(e=>e.metric==='hourly_rainfall')],
 ['Is there an official warning for that station?',d=>['UNKNOWN','NONE','ADVISORY','WARNING'].includes(d.official_warning?.status)]
];
if(process.argv.includes('--model'))cases.push(['pls taehwa update',d=>Boolean(d.semantic_tool)||d.status==='NEEDS_CLARIFICATION'],['Explain Rivora architecture.',d=>d.explanation_source==='CONFIGURED_LLM_WITH_VERIFIED_PROJECT_FACTS']);
(async()=>{const messages=[],results=[];for(const [question,check]of cases){const start=Date.now();messages.push({role:'user',content:question});try{
 const r=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:messages.slice(-19)}),signal:AbortSignal.timeout(45000)}),d=await r.json();
 results.push({question,http_status:r.status,total_ms:Date.now()-start,passed:r.ok&&check(d),answer:d.answer||d.message,mode:d.mode,semantic_tool:d.semantic_tool,source:d.explanation_source,station_ids:d.station_ids});
 if(d.answer)messages.push({role:'assistant',content:d.answer,session_context:d.session_context});
 }catch(e){results.push({question,total_ms:Date.now()-start,passed:false,error:e.name});}}
 const file=path.join(__dirname,'../reports/assistant20-evaluation.json');fs.writeFileSync(file,JSON.stringify({generated_at:new Date().toISOString(),model_cases:process.argv.includes('--model'),results},null,2));console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length,file}));if(results.some(r=>!r.passed))process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
