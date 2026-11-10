const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../assistant-core'),{resolvePlaces}=require('../place-resolver');
const {bounded,safeExplanation}=require('../assistant-v2-routes');
const now=Date.parse('2026-11-09T10:00:00+09:00');
const stations=[{station_id:207,station_name:'Taehwa Bridge',external_station_id:'2201670',data_source:'RIVER_GAUGE',latitude:35.55,longitude:129.3},{station_id:31,station_name:'Ulsan',external_station_id:'152',data_source:'KMA',latitude:35.55,longitude:129.3},{station_id:2912,station_name:'가평군(선촌2교)',external_station_id:'1015636',data_source:'RIVER_GAUGE',latitude:37.7,longitude:127.5}];
function fixture(){const calls=[];return {calls,async execute(sql,args){calls.push({sql,args});
 if(sql.includes('FROM stations'))return [stations];
 if(sql.includes('SELECT DISTINCT river_id'))return [[{river_id:'taehwa'},{river_id:'dongcheon'},{river_id:'hoeya'}]];
 if(sql.includes('FROM water_readings'))return [[{observed_at:'2026-11-09 09:50:00',water_level:4.3}]];
 if(sql.includes('FROM weather_readings'))return [[{observed_at:'2026-11-09 09:00:00',temperature:12,hourly_rainfall:0}]];
 if(sql.includes('station_rainfall_links'))return [[{observed_at:'2026-11-09 09:00:00',hourly_rainfall:1.2,aws_station_code:'999'}]];
 if(sql.includes('weather_forecasts')||sql.includes('ml_advanced_predictions'))return [[]];
 throw Error('Unexpected query: '+sql);
 }};}
const noDb={execute(){assert.fail('Knowledge must not read monitoring data');}};
for(const [q,re]of [['What is Rivora?',/React.*Express.*MySQL/],['Who developed Rivora?',/Nishan/],['Can Rivora predict floods?',/not validated flood probabilities/],['What does failed warning-model validation mean?',/1.9%.*20%/]])test(q,async()=>{const r=await core.answer(q,{db:noDb});assert.match(r.answer,re);});
test('Ulsan river count uses distinct verified river identities, not city weather',async()=>{const db=fixture(),r=await core.answer('How many rivers does Rivora monitor in Ulsan?',{db,now});assert.equal(r.river_count,3);assert.match(r.answer,/Taehwa/);assert.equal(db.calls.length,1);assert.ok(db.calls[0].sql.includes('verification_status'));});
test('latest Taehwa water level is queried and timestamped',async()=>{const db=fixture(),r=await core.answer('What is the latest water level at Taehwa Bridge?',{db,now});assert.match(r.answer,/4.3 m/);assert.match(r.answer,/09:50/);assert.deepEqual(r.station_ids,[207]);assert.equal(r.evidence.find(e=>e.metric==='water_level').value,4.3);});
test('a water-level request does not fetch unrelated weather; unknown new places do not inherit old ones',async()=>{
 const db=fixture();const r=await core.answer('Taehwa Bridge water level',{db,now});assert.ok(!db.calls.some(c=>/weather_readings|rainfall_readings/.test(c.sql)));assert.doesNotMatch(r.answer,/rainfall|temperature/i);
 const previous=[{role:'user',content:'Taehwa Bridge water level'},{role:'assistant',content:r.answer,session_context:r.session_context}];
 const next=await core.answer('Unknownville weather',{db,previous,now});assert.equal(next.status,'NEEDS_CLARIFICATION');assert.deepEqual(next.station_ids,[]);
});
test('Seonchon search then rainfall and station recall preserve the gauge identity',async()=>{
 const db=fixture(),previous=[];
 for(const q of ['Find Gapyeong-gun (Seonchon 2 Bridge).','What about its rainfall?','Which station are we discussing?']){
  const r=await core.answer(q,{db,now,previous});assert.deepEqual(r.station_ids,[2912]);
  if(q.includes('rainfall')){assert.match(r.answer,/1.2 mm/);assert.equal(db.calls.at(-1).args[0],2912);}else assert.match(r.answer,/1015636/);
  previous.push({role:'user',content:q},{role:'assistant',content:r.answer,session_context:r.session_context});
 }
});
test('ambiguous yes retains actual candidates, ordinal selects one, no clears them',async()=>{
 const db=fixture(),candidates=stations.filter(s=>s.data_source==='RIVER_GAUGE').map(s=>({station_id:s.station_id,station_code:s.external_station_id,station_name:s.station_name}));
 const previous=[{role:'assistant',content:'Which station?',session_context:{candidates,pending_question:'current water level'}}];
 const yes=await core.answer('yes',{db,previous,now});assert.equal(yes.status,'NEEDS_CLARIFICATION');assert.equal(yes.candidates.length,2);
 const second=await core.answer('second',{db,previous,now});assert.deepEqual(second.station_ids,[2912]);
 const no=await core.answer('no',{db,previous,now});assert.deepEqual(no.session_context.candidates,[]);
});
test('saved text codes restore selected station; a new session never inherits it',async()=>{
 const previous=[{role:'assistant',content:'Seonchon Bridge [station code 1015636]'}];
 const r=await core.answer('Which station are we discussing?',{db:fixture(),previous,now});assert.deepEqual(r.station_ids,[2912]);
 const empty=await core.answer('Which station are we discussing?',{db:fixture(),now});assert.equal(empty.status,'NEEDS_CLARIFICATION');
});
test('official codes override fuzzy matches and known romanization is supported',()=>{
 assert.equal(resolvePlaces('station 1015636',stations)[0].station_id,2912);
 assert.equal(resolvePlaces('Find Seonchon2gyo',stations)[0].station_id,2912);
 assert.equal(resolvePlaces('Find Seonchon',stations)[0].station_id,2912);
 assert.equal(resolvePlaces('station 152',stations)[0].station_id,31);
 assert.deepEqual(resolvePlaces('station 9999999',stations),[]);
});
test('tomorrow rainfall follow-up remains a forecast for the selected river context',async()=>{
 const r=await core.answer('What about tomorrow?',{db:fixture(),now,previous:[{role:'user',content:'Seonchon Bridge rainfall'},{role:'assistant',content:'Rainfall',session_context:{station_id:2912,station_code:'1015636',candidates:[],subject:'rainfall'}}]});assert.deepEqual(r.station_ids,[2912]);assert.ok(r.tools.includes('get_weather_forecast'));assert.match(r.answer,/No stored weather forecast/);
});
test('bounded requests finish even if an upstream operation ignores cancellation',async()=>{await assert.rejects(bounded(new Promise(()=>{}),10),{name:'TimeoutError'});assert.equal(safeExplanation('It is currently 24 °C.'),false);assert.equal(safeExplanation('Rivora provides official warnings.'),false);assert.equal(safeExplanation('Rivora displays recorded observations from official sources.'),true);});
test('project explanations use one configured provider call; timeouts retain verified facts',async()=>{
 const {createHandler}=require('../assistant-v2-routes'),{EventEmitter}=require('events');
 for(const stalled of [false,true]){
  let calls=0,payload;const res=new EventEmitter();res.json=value=>{payload=value;res.writableEnded=true;};res.status=()=>res;
  const handler=createHandler({answer:async()=>({mode:'PROJECT_GUIDANCE',answer:'Rivora displays recorded observations.',evidence:[]}),provider:async()=>{calls++;return stalled?new Promise(()=>{}):'Rivora helps you explore recorded observations from official sources.';},explanationTimeoutMs:10});
  await handler({path:'/chat',body:{messages:[{role:'user',content:'What is Rivora?'}]}},res);
  assert.equal(calls,1);assert.match(payload.answer,/recorded observations/);assert.equal(payload.explanation_source,stalled?'VERIFIED_PROJECT_FACTS':'CONFIGURED_LLM_WITH_VERIFIED_PROJECT_FACTS');
 }
});

test('river-list context survives which-ones follow-up without another query',async()=>{
 const first=await core.answer('How many rivers are monitored in Ulsan?',{db:fixture(),now});
 const r=await core.answer('Which ones?',{db:noDb,now,previous:[{role:'user',content:'How many rivers are monitored in Ulsan?'},{role:'assistant',content:first.answer,session_context:first.session_context}]});assert.match(r.answer,/Taehwa.*Dongcheon.*Hoeya/);
});
test('six-hour change uses actual endpoints and retains station context',async()=>{
 const db={execute:async(sql,args)=>{if(sql.includes('FROM stations'))return [stations];return [[sql.includes('BETWEEN')?{observed_at:'2026-11-09 03:50:00',water_level:4.1}:{observed_at:'2026-11-09 09:50:00',water_level:4.3}]];}};
 const r=await core.answer('How much did its level change in six hours?',{db,now,previous:[{role:'assistant',content:'Taehwa',session_context:{station_id:207,candidates:[]}}]});assert.match(r.answer,/\+0.20 m over 360 minutes/);assert.equal(r.evidence.length,2);assert.deepEqual(r.station_ids,[207]);
});
test('project retrieval describes current registration and exact official alert coverage',async()=>{
 for(const q of ['How does registration work?','Explain location-based email alerts']){const r=await core.answer(q,{db:noDb});assert.match(r.answer,/Exact coordinates are not saved/);assert.match(r.answer,/exact verified station coverage/);}
});
test('network ranking excludes stale, non-comparable and missing changes',async()=>{
 const r=await core.answer('Which river has the highest recent rise?',{db:noDb,now,getUnified:async()=>[{station_id:207,station_name:'Taehwa',data_status:'FRESH',observed_at:'2026-11-09 09:50:00',rise_1h:.2,rise_interval_1h_minutes:60},{station_id:9,data_status:'STALE',rise_1h:100}]});assert.match(r.answer,/0.20 m/);assert.deepEqual(r.station_ids,[207]);
});
