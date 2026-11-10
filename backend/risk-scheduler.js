const {getUnified}=require('./risk-engine');
const config=require('./config/risk-config');
let running=false;
async function persistAssessments(db=require('./db')){
 if(running)return;running=true;
 try{const rows=await getUnified({force:true});for(const r of rows)await db.execute(`INSERT INTO risk_assessments(station_id,assessed_at,risk_level,risk_score,reason,method_version,input_observed_at,evidence_json) VALUES(?,UTC_TIMESTAMP()+INTERVAL 9 HOUR,?,?,?,?,?,?)`,[r.station_id,r.level||'Unknown',r.score,`${r.basis}: ${r.reasons.join(', ')}`.slice(0,255),'UNIFIED_RISK_V1',r.observed_at,JSON.stringify(r)]);return rows;}finally{running=false;}
}
function startRiskScheduler(){const tick=()=>persistAssessments().catch(e=>console.error('[Unified risk]',e.code||e.message));tick();return setInterval(tick,config.intervalMs);}
module.exports={persistAssessments,startRiskScheduler};
