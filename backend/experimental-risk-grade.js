'use strict';
// An interpretable experimental *screening priority*, not flood event probabilities.
// These chosen breakpoints are research heuristics, NOT official flood-stage criteria.
const number = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const complete = v => v?.status === 'COMPLETE' && number(v.rainfall_mm) !== null;
function grade(potential) {
  const base = {station_id: potential?.station_id ?? null, status: 'UNAVAILABLE',
    grade: null, score: null, grade_type: 'EXPERIMENTAL_FLOOD_POTENTIAL_V2',
    is_validated_flood_risk: false, is_official_warning: false, flood_probability: null,
    warning: 'Unvalidated screening heuristic, not an official flood warning or a calibrated probability. A Low indicator does not establish safety.',
    evidence: [], missing: []};
  if (!potential || potential.status !== 'EXPERIMENTAL_INDICATORS' ||
      potential.level_screening?.status !== 'EXPERIMENTAL_SCREENING') {
    return {...base, reason: potential?.reason || 'REQUIRED_LEVEL_EVIDENCE_UNAVAILABLE'};
  }
  // This screening is derived only from recorded station-specific level percentiles,
  // observed 1-hour trend, and complete nearby KMA rainfall windows.
  const pct=number(potential.level_screening.percentile_rank);
  if (pct === null || pct < 0 || pct > 100) return {...base,reason:'MISSING_HISTORICAL_PERCENTILE'};
  const change=number(potential.observed_conditions?.previous_hour_change_m);
  const change3=number(potential.level_screening?.previous_3_hour_change_m);
  if (change === null) return {...base,reason:'ONE_HOUR_TREND_NOT_AVAILABLE'};
  const rain3=potential.regional_rainfall?.observed_3h;
  const rain6=potential.regional_rainfall?.observed_6h;
  const rain12=potential.regional_rainfall?.observed_12h;
  const rain24=potential.regional_rainfall?.observed_24h;
  const has6=complete(rain6),has24=complete(rain24);
  const future=potential.forecast_rainfall;
  const futureMin=future?.status==='COMPLETE'?number(future.rainfall_min_mm):null;
  const evidence=[`Station historical water-level percentile ${pct.toFixed(1)}`,`Observed 1-hour level change ${change.toFixed(3)} m`];
  const components={level:0,rise:0,short_rainfall:0,long_rainfall:0,forecast_rainfall:0};
  const missing=[];
  let score=0;
  // These are explicit, adjustable, *unvalidated* monitoring breakpoints.
  // Overlapping rainfall periods are grouped so the same storm is not counted
  // multiple times within the short- and long-duration contributions.
  if(pct>=99){components.level=55;evidence.push('At/above station historical 99th percentile');}
  else if(pct>=95){components.level=40;evidence.push('At/above station historical 95th percentile');}
  else if(pct>=90)components.level=25;
  else if(pct>=75)components.level=10;
  const rise1=change>=.30?20:change>=.10?12:change>=.03?6:0;
  const rise3=change3===null?0:change3>=.90?20:change3>=.40?12:change3>=.15?6:0;
  components.rise=Math.max(rise1,rise3);
  if(change3!==null)evidence.push(`Observed 3-hour level change ${change3.toFixed(3)} m`);

  if(components.rise)evidence.push('Observed river level increasing');
  const short3=complete(rain3)?number(rain3.rainfall_mm):null;
  const short6=has6?number(rain6.rainfall_mm):null;
  const long12=complete(rain12)?number(rain12.rainfall_mm):null;
  const long24=has24?number(rain24.rainfall_mm):null;
  const short3Points=short3===null?0:short3>=50?25:short3>=25?15:short3>=10?6:0;
  const short6Points=short6===null?0:short6>=50?25:short6>=20?15:short6>=5?6:0;
  components.short_rainfall=Math.max(short3Points,short6Points);
  const long12Points=long12===null?0:long12>=100?20:long12>=50?12:long12>=20?5:0;
  const long24Points=long24===null?0:long24>=100?20:long24>=50?12:long24>=20?5:0;
  components.long_rainfall=Math.max(long12Points,long24Points);
  for(const [hrs,window] of [[3,rain3],[6,rain6],[12,rain12],[24,rain24]]){
    if(complete(window))evidence.push(`Nearby KMA observed ${hrs}h rainfall: ${window.rainfall_mm} mm (regional proxy)`);
  }
  if(!has6)missing.push('Complete 6-hour KMA rainfall');
  if(!has24)missing.push('Complete 24-hour KMA rainfall');
  if(futureMin!==null&&futureMin>=0){
    components.forecast_rainfall=futureMin>=60?15:futureMin>=30?10:futureMin>=10?5:0;
    evidence.push(`Next 6h nearby KMA forecast rainfall: ${future.rainfall_min_mm}–${future.rainfall_max_mm} mm (issued forecast, regional proxy)`);
  }
  score=Math.min(100,Object.values(components).reduce((sum,n)=>sum+n,0));
  // IMPORTANT: do not issue 'Low' from incomplete rainfall; no data != no rain.
  const fullRain=has6&&has24;
  const proposed=score>=60?'High':score>=30?'Moderate':'Low';
  const grade=proposed==='Low'&&!fullRain?null:proposed;
  return {...base,status:grade?'EXPERIMENTAL_GRADE':'PARTIAL_EVIDENCE', grade,
    // The partial evidence points are diagnostic only; never present them as a risk score.
    score:grade ? score : null, partial_evidence_points:grade ? null : score,
    missing, evidence,components,reason:grade?null:'INSUFFICIENT_RAINFALL_FOR_LOW_GRADE',
    interpretation:grade ? `Experimental ${grade.toLowerCase()} flood-potential screening based on station history and observed rain; not a validated flood event prediction.` :
      'Partial evidence only. A low score with incomplete rainfall does not justify a Low risk label.',
    methodology:'V2 research heuristic: station percentile (0–55), max 1h/3h rise (0–20), max observed 3h/6h rain (0–25), max observed 12h/24h rain (0–20), 6h KMA forecast lower bound (0–15). Overlap is not double-counted within rain/trend groups. Bands: <30 Low, 30–59 Moderate, >=60 High; Low requires complete observed 6h and 24h. All rain is a regional proxy, not gauge-catchment rainfall. Not trained or calibrated against flood events.'};
}
function enrich(data) {
  const list=(data?.data||[]).map(p=>({...p,experimental_risk:grade(p)}));
  return {...data,experiment_version:'EXPERIMENTAL_FLOOD_POTENTIAL_V2',
    count_graded:list.filter(x=>x.experimental_risk.grade!==null).length,
    count_partial:list.filter(x=>x.experimental_risk.status==='PARTIAL_EVIDENCE').length,
    count_unavailable:list.filter(x=>x.experimental_risk.status==='UNAVAILABLE').length,
    grade_counts: {Low:list.filter(x=>x.experimental_risk.grade==='Low').length,Moderate:list.filter(x=>x.experimental_risk.grade==='Moderate').length,High:list.filter(x=>x.experimental_risk.grade==='High').length},
    disclaimer:'Experimental unvalidated screening only. Results are NOT official warnings or calibrated flood probabilities, and cannot demonstrate safety.',data:list};
}
module.exports={grade,enrich};
