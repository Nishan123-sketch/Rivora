'use strict';
const {enrich}=require('./experimental-risk-grade');
const {latestBulletins}=require('./hrfco-station-bulletins');
const {getFeedStatus}=require('./hrfco-live-feed');
function display(station,bulletin=null) {
  const experiment=station.experimental_risk||{};
  const base={station_id:station.station_id,wamis_code:station.wamis_code||null,
    observation_status:station.observed_at? 'FRESH' : 'UNKNOWN',
    observed_at:station.observed_at||null,water_level_m:station.water_level_m,
    official_warning_status:'UNVERIFIED_CURRENT_STATUS',
    is_official_warning:false,
    bulletin:bulletin||null,
    grade:null,score:null,source:'NONE',label:'Insufficient evidence',
    detail:'No current verified stage comparison or complete fallback model evidence.',
    model_validation:'NOT_VALIDATED_FOR_FLOOD_EVENTS',
    flood_probability:null};
  if(station.status==='UNAVAILABLE'&&station.reason==='WATER_LEVEL_NOT_FRESH'){
    return {...base,label:'Stale or missing water level',detail:'No assessment from outdated WAMIS readings.',source:'DATA_QUALITY'};
  }
  if(station.official_risk_basis==='VERIFIED_STAGE'&&station.official_flood_risk){
    return {...base,grade:station.official_flood_risk,
      label:`Verified stage: ${station.official_flood_risk}`,
      source:'VERIFIED_STATION_STAGE',
      detail:'Assessment from verified station-specific criteria, NOT an issued government warning.'};
  }
  if(experiment.status==='EXPERIMENTAL_GRADE'&&experiment.grade){
    return {...base,grade:experiment.grade,score:experiment.score,
      source:'EXPERIMENTAL_WAMIS_KMA',label:`Experimental ${experiment.grade}`,
      detail:`Screening index ${experiment.score}/100 (NOT a probability or validated future flood forecast).`};
  }
  if(experiment.status==='PARTIAL_EVIDENCE'){
    return {...base,label:'Insufficient rainfall evidence',source:'DATA_QUALITY',
      detail:`Cannot assign Low while observed 6h/24h rain is incomplete. Missing: ${(experiment.missing||[]).join(', ')}.`};
  }
  return {...base,label:'Not assessed',source:'DATA_QUALITY',
    detail:experiment.reason||station.reason||'Insufficient station-specific historical evidence.'};
}
async function getHybrid(db=require('./db')){
  const {getFloodPotential}=require('./experimental-flood-potential');
  const [potential,notices]=await Promise.all([getFloodPotential(db),latestBulletins(db)]);
  const scored=enrich(potential);
  const data=scored.data.map(station=>({
    ...station,
    official_bulletin:notices.byCode.get(String(station.wamis_code))||null,
    hybrid_assessment:display(station,notices.byCode.get(String(station.wamis_code))||null)
  }));
  return {success:true,generated_at:new Date().toISOString(),total_gauges:data.length,
    count_experimental_graded:data.filter(x=>x.hybrid_assessment.source==='EXPERIMENTAL_WAMIS_KMA').length,
    count_verified_stages:data.filter(x=>x.hybrid_assessment.source==='VERIFIED_STATION_STAGE').length,
    count_insufficient:data.filter(x=>x.hybrid_assessment.source==='DATA_QUALITY').length,
    historical_warning_coverage:notices.status,
    historical_bulletin_station_matches:data.filter(x=>x.official_bulletin!==null).length,
    live_flood_notice_feed:getFeedStatus(),
    validated_future_flood_warning_probability_available:false,
    disclaimer:'Official bulletins in this response are past recorded notices, NOT verified active warnings. Fallback grades are unvalidated monitoring heuristics, NOT 3-hour flood probabilities.',data};
}
module.exports={display,getHybrid};
