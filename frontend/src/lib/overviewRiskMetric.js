const number=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
export function overviewRiskMetric(a){
 if(!a?.level)return {title:'ASSESSMENT STATUS',value:'Not assessed',detail:a?.measurement_compatibility?.verified===false?'Reference verification required':a?.data_status?.replaceAll('_',' ')||'Awaiting assessment',explanation:a?.measurement_compatibility?.note||'A current compatible observation is required.'};
 if(a.tier==='A'){
  const warning=number(a.warning_stage_m),water=number(a.water_level);
  if(warning!==null&&warning>0&&water!==null){const percent=water/warning*100;return {title:'WARNING-STAGE INDEX',value:`${Math.round(Math.max(0,Math.min(100,percent)))}/100`,detail:`${water.toFixed(2)} m current / ${warning.toFixed(2)} m warning stage`,explanation:percent>=100?'Warning stage reached. Comparison only.':'Relative to warning stage; not a flood probability.'};}
  return {title:'OFFICIAL STAGE COMPARISON',value:a.level,detail:'Verified station thresholds',explanation:'Threshold category; not an issued warning or flood probability.'};
 }
 const score=number(a.score);
 return {title:'ESTIMATED RISK SCORE',value:score===null?'Unavailable':`${score}/100`,detail:'Relative to this station’s history',explanation:'Uncalibrated project estimate; not a flood probability.'};
}
