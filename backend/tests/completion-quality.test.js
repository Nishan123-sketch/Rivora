const test=require('node:test'),assert=require('node:assert/strict');
const {currentOfficial}=require('../warning-timeline');
const {regimeEvaluation}=require('../ai-water-level-outlook');
test('blocked publication coverage rejects pretty JSON and object evidence',()=>{
 const at='2026-11-07 12:00:00',now=Date.parse('2026-11-07T03:05:00Z');
 for(const evidence of [{live_status_blocked:true},JSON.stringify({live_status_blocked:true},null,2)]){
  assert.equal(currentOfficial([],[{status:'COMPLETE',initial_state:'NONE',start_at:at,end_at:at,checked_at:'2026-11-07 03:01:00',evidence}],now).status,'UNKNOWN');
 }
});
test('regime evaluation uses training cutoff and never makes missing rainfall dry',()=>{
 const result=regimeEvaluation(Array.from({length:10},(_,level)=>({level})),[{level:9,actual:10,rain6:2},{level:1,actual:1,rain6:0},{level:100,actual:101,rain6:null}],null,'PERSISTENCE');
 assert.equal(result.upper_training_decile_cutoff_m,8);
 assert.equal(result.groups.wet.samples,1);assert.equal(result.groups.dry.samples,1);
 assert.equal(result.groups.upper_training_decile.samples,2);
 assert.equal(result.groups.wet.status,'LIMITED_SAMPLES');assert.equal(result.groups.wet.chosen.mae_m,1);
});
