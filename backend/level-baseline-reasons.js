'use strict';
const policy=require('./ml/level_policy.json');
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function baselineEvidence(h){
 if(h.advanced_accepted===true)return null;
 if(h.fallback_reason)return {summary:({RAINFALL_SOURCE_MISMATCH:'Rainfall source changed; evaluated baseline retained.',EXPIRED_ADVANCED_ORIGIN_EVALUATED_BASELINE_USED:'Advanced input origin expired; evaluated baseline retained.',MODEL_FEATURE_GAPS_EVALUATED_BASELINE_USED:'Advanced input window incomplete; evaluated baseline retained.'})[h.fallback_reason]||'Advanced inputs unavailable; evaluated baseline retained.',reasons:[h.fallback_reason],candidates:[]};
 const e=h.evaluation,a=policy.acceptance;
 if(!e)return {summary:h.reason||h.model_rejection_reason||'Acceptance evidence unavailable.',reasons:[h.reason||h.model_rejection_reason||'ACCEPTANCE_EVIDENCE_UNAVAILABLE'],candidates:[]};
 const baseline=e.selection_candidates?.PERSISTENCE,candidates=[];
 for(const [name,m] of Object.entries(e.selection_candidates||{})){
  if(name==='PERSISTENCE')continue;
  const failures=[],folds=e.rolling_origin?.[name]||[];
  if(!finite(m.mae_m)||!finite(baseline?.mae_m)||m.mae_m>=baseline.mae_m*(1-a.selection_mae_relative_improvement))failures.push('Selection MAE improvement below required 5%');
  if(!finite(m.rmse_m)||!finite(baseline?.rmse_m)||m.rmse_m>baseline.rmse_m*a.selection_rmse_ratio_max)failures.push('Selection RMSE worse than persistence');
  if(folds.length<a.rolling_origin_required_folds||folds.some(f=>!finite(f.selected?.mae_m)||!finite(f.persistence?.mae_m)||f.selected.mae_m>f.persistence.mae_m))failures.push('Rolling-origin consistency not met');
  candidates.push({name,selection:m,persistence:baseline,failures});
 }
 const reasons=[];
 if(e.chosen_on_development==='PERSISTENCE'){
  reasons.push(...new Set(candidates.flatMap(c=>c.failures)));
 }else{
  if(!finite(e.mae_improvement_fraction)||e.mae_improvement_fraction<a.test_mae_relative_improvement)reasons.push('Holdout MAE improvement below required 5%');
  if(!finite(e.chosen_test?.rmse_m)||!finite(e.persistence?.rmse_m)||e.chosen_test.rmse_m>e.persistence.rmse_m*a.test_rmse_ratio_max)reasons.push('Holdout RMSE worse than persistence');
  for(const [name,g] of Object.entries(e.regimes?.groups||{}))if(['rising','high_water_proxy'].includes(name)&&g.samples>=a.minimum_regime_samples&&(!finite(g.selected?.mae_m)||!finite(g.persistence?.mae_m)||g.selected.mae_m>g.persistence.mae_m*a.regime_mae_ratio_max))reasons.push(name==='rising'?'Rising-water error exceeds allowed ratio':'High-water error exceeds allowed ratio');
  const ci=e.block_uncertainty?.ci95_mae_improvement_m;
  if(!ci||!finite(ci[0])||ci[0]<=a.improvement_ci_lower_m_min)reasons.push('Time-block improvement confidence not established');
 }
 const summary=e.chosen_on_development==='PERSISTENCE'?'Candidates failed development accuracy or consistency checks.':reasons.join('; ')+'.';
 return {summary:reasons.length?summary:'Advanced acceptance not established.',reasons:reasons.length?reasons:['Advanced acceptance not established'],chosen_on_development:e.chosen_on_development,candidates};
}
module.exports={baselineEvidence};
