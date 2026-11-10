const test=require('node:test'),assert=require('node:assert/strict');
const {baselineEvidence}=require('../level-baseline-reasons');
test('accepted forecasts are not described as rejected',()=>assert.equal(baselineEvidence({advanced_accepted:true}),null));
test('rainfall fallback is distinguished from failed accuracy',()=>{const r=baselineEvidence({fallback_reason:'MODEL_FEATURE_GAPS_EVALUATED_BASELINE_USED'});assert.match(r.summary,/input window incomplete/);assert.deepEqual(r.candidates,[]);});
test('MAE improvements cannot hide RMSE and rolling-origin failures',()=>{
 const r=baselineEvidence({evaluation:{chosen_on_development:'PERSISTENCE',selection_candidates:{PERSISTENCE:{mae_m:1,rmse_m:2},RIDGE:{mae_m:.9,rmse_m:2.1}},rolling_origin:{RIDGE:[{selected:{mae_m:1.1},persistence:{mae_m:1}},{selected:{mae_m:.9},persistence:{mae_m:1}}]}}});
 assert.deepEqual(r.candidates[0].failures,['Selection RMSE worse than persistence','Rolling-origin consistency not met']);
});
test('holdout average improvement is insufficient without positive block confidence',()=>{
 const r=baselineEvidence({evaluation:{chosen_on_development:'BOUNDED_TREND',mae_improvement_fraction:.11,chosen_test:{rmse_m:.01},persistence:{rmse_m:.02},block_uncertainty:{ci95_mae_improvement_m:[-.001,.003]}}});
 assert.deepEqual(r.reasons,['Time-block improvement confidence not established']);
});
