const {test}=require('node:test'),assert=require('node:assert/strict');
const {liveFeatures,warningPrediction}=require('../advanced-ml-service');
const {featureSnapshot,kst}=require('../advanced-ml-features');
const now=Date.parse('2026-11-09T02:15:00+09:00'),origin=Date.parse('2026-11-09T02:00:00+09:00');
const water=Array.from({length:73},(_,i)=>({observed_at:kst(origin-i*3600000),water_level:4.64}));
const rain=Array.from({length:24},(_,i)=>({observed_at:kst(origin-i*3600000),hourly_rainfall:0}));
function fakeDb(){return {execute:async sql=>sql.startsWith('SELECT observed_at,water_level')?[water]:sql.startsWith('SELECT * FROM station_rainfall_links')?[[]]:[{}]};}
const link={rainfall_station_code:'22014080',gauge_name:'Taehwa',distance_km:.031};
test('completed official rainfall repair is reread before returning quality',async()=>{
 let repaired=false,calls=0;
 const result=await liveFeatures(987701,{database:fakeDb(),now,recentRain:async()=>({link,rows:repaired?rain:rain.slice(1)}),repairRain:async()=>{calls++;repaired=true;}});
 assert.equal(calls,1);assert.equal(result.quality.status,'FRESH');assert.equal(result.features.rain_24h,0);
 assert.equal(result.quality.rainfall_coverage.available_hours,24);assert.deepEqual(result.quality.rainfall_coverage.missing_hours,[]);
});
test('unavailable official rainfall remains missing and reports exact hours',async()=>{
 const result=await liveFeatures(987702,{database:fakeDb(),now,recentRain:async()=>({link,rows:rain.slice(1)}),repairRain:async()=>{}});
 assert.equal(result.quality.status,'INCOMPLETE');assert.equal(result.features.rain_24h,null);
 assert.deepEqual(result.quality.rainfall_coverage.missing_hours,['2026-11-09 02:00:00']);
});
test('complete current rainfall does not trigger another archive download',async()=>{
 const result=await liveFeatures(987703,{database:fakeDb(),now,recentRain:async()=>({link,rows:rain}),repairRain:async()=>{throw Error('UNNECESSARY_REPAIR');}});
 assert.equal(result.quality.rainfall_repair_status,'NOT_NEEDED');assert.equal(result.quality.status,'FRESH');
});
test('slow recovery returns an explicit pending state without inventing rain',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 try{const result=await liveFeatures(987704,{database:fakeDb(),now,recentRain:async()=>({link,rows:rain.slice(1)}),repairRain:()=>pending,repairWaitMs:5});
 assert.equal(result.quality.rainfall_repair_status,'IN_PROGRESS');assert.equal(result.features.rain_24h,null);}finally{finish();}
});
test('future rainfall cannot satisfy the missing current model hour',()=>{
 const result=featureSnapshot(water,[...rain.slice(1),{observed_at:kst(origin+3600000),hourly_rainfall:0}],now,.031);
 assert.equal(result.quality.rainfall_coverage.available_hours,23);assert.equal(result.features.rain_1h,null);
});
test('fresh recovered inputs cannot enable a model that failed independent evaluation',async()=>{
 const result=await warningPrediction({station_id:207,external_station_id:'2201670'},{quality:{status:'FRESH'},feature_time:'2026-11-09 02:00:00'},{status:'NONE'},{status:'INDEPENDENT_TEST_ACCEPTANCE_FAILED',probability_available:true});
 assert.equal(result.status,'INDEPENDENT_TEST_ACCEPTANCE_FAILED');assert.equal(result.probability,null);assert.equal(result.data_quality_status,'FRESH');
});
test('inference withholds inconsistent supposedly validated report evidence',async()=>{
 const result=await warningPrediction({station_id:207,external_station_id:'2201670'},{quality:{status:'FRESH'}},{status:'NONE'},{status:'VALIDATED_WARNING_FORECAST',probability_available:true,test:{precision:.01,event_detection_rate:.9,brier_score:.2}});
 assert.equal(result.reason,'VALIDATION_EVIDENCE_INCONSISTENT');assert.equal(result.probability,null);
});
