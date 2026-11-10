const {summaries}=require('./monitoring-store');
const {latestOfficialAlerts}=require('./official-alerts');
function projectAlerts(rows){const alerts=[];for(const s of rows){
 if(s.data_source!=='KMA'&&['Moderate','High','Severe'].includes(s.risk_level))alerts.push({id:`river-${s.station_id}`,station_id:s.station_id,area:s.station_name,risk_level:s.risk_level,reason:s.unified_risk?`${s.unified_risk.basis}: ${s.unified_risk.reasons.join(', ')}`:'Assessment unavailable',observed_at:s.water_observed_at,kind:'Project river assessment'});
 const c=s.rainfall_comparison;const severity=c?.status==='WARNING_CRITERION_MET'?'High':c?.status==='ADVISORY_CRITERION_MET'?'Moderate':null;
 if(severity)alerts.push({id:`rain-${s.station_id}`,station_id:s.station_id,area:s.station_name,risk_level:severity,reason:`Heavy rainfall: 3h ${c.rainfall_3h_mm??'missing'} mm / 12h ${c.rainfall_12h_mm??'missing'} mm. Published rainfall reference criterion exceeded.`,observed_at:s.rainfall_observed_at,kind:'Project rainfall assessment',source:c.source_url});
 }return alerts;}
async function riskAlerts(){const rows=await require('./official-station-policy').publicStations(await summaries());let official;try{official=await latestOfficialAlerts();try{official=await require('./wind-alerts').enrichWindAlerts(official);}catch{/* Keep issued warnings visible when observations are unavailable. */}}catch{official={status:'No official feed data',data:[]};}return {success:true,data:projectAlerts(rows),official,coverage:{stations:rows.length,fresh:rows.filter(s=>s.data_status==='Fresh').length},message:'No matching alerts is not proof of safety. Areas without observations cannot be assessed.'};}
module.exports={projectAlerts,riskAlerts};
