const {test}=require('node:test'),assert=require('node:assert/strict');
const {contextualQuestion}=require('../assistant-followups'),{launchConfig}=require('../local-assistant');
for(const [question,prior,expected]of [
 ['what about tomorrow?','Taehwa Bridge water level','river water level'],
 ['what about Busan?','Ulsan weather','weather'],
 ['and yesterday?','Ulsan wind speed','wind speed'],
 ['내일은?','울산 날씨','weather'],
 ['what about next week?','Taehwa flood risk','flood risk'],
 ['what about there?','Ulsan rainfall','rainfall']
])test('follow-up preserves subject: '+question,()=>assert.ok(contextualQuestion(question,[{role:'user',content:prior}]).includes(expected)));
test('explicit new topic replaces prior topic',()=>assert.equal(contextualQuestion('What about wind in Busan?',[{role:'user',content:'Taehwa river level'}]),'What about wind in Busan?'));
test('casual conversation does not inherit measurements',()=>assert.equal(contextualQuestion('thank you',[{role:'user',content:'Ulsan weather'}]),'thank you'));
test('assistant text cannot select inherited subject',()=>assert.equal(contextualQuestion('what about tomorrow',[{role:'assistant',content:'Seoul weather'}]),'what about tomorrow'));
test('new topic without history does not acquire a location',()=>assert.equal(contextualQuestion('what about tomorrow',[]),'what about tomorrow'));
test('runtime CPU fallback when GPU/model files absent',()=>{const c=launchConfig({},()=>false);assert.ok(c.model.endsWith('llama3.2-1b.gguf'));assert.equal(c.args.at(-1),'0');assert.equal(c.args[c.args.indexOf('--host')+1],'127.0.0.1');});
test('runtime upgrade has bounded GPU layers/context',()=>{const c=launchConfig({LLM_GPU_LAYERS:'500',LLM_LOCAL_CONTEXT:'999999'},()=>true);assert.ok(c.model.endsWith('Qwen3-4B-Q4_K_M.gguf'));assert.equal(c.args.at(-1),'28');assert.equal(c.args[c.args.indexOf('-c')+1],'4096');});
test('runtime accepts explicit portable deployment paths',()=>{const c=launchConfig({LLM_LOCAL_EXECUTABLE:'/srv/llama-server',LLM_LOCAL_MODEL_PATH:'/models/qwen.gguf',LLM_GPU_LAYERS:'0'},()=>false);assert.equal(c.exe,'/srv/llama-server');assert.equal(c.model,'/models/qwen.gguf');assert.equal(c.args.at(-1),'0');});
test('reasoning markup is not shown or stored as the final answer',()=>{const {finalText}=require('../assistant-model-text');assert.equal(finalText('<think>private draft</think>Hello!'),'Hello!');assert.equal(finalText('<think>unfinished draft'),'');});
test('river tomorrow follow-up cannot silently become weather',async()=>{
 const calls=[];const db={execute:async(sql)=>{calls.push(sql);if(sql.includes('FROM stations'))return [[{station_id:207,station_name:'Taehwa Bridge',external_station_id:'2201670',data_source:'RIVER_GAUGE'}]];if(sql.includes('ml_advanced_predictions'))return [[]];throw Error('Unexpected weather query');}};
 const result=await require('../assistant-core').answer('what about tomorrow?',{db,previous:[{role:'user',content:'Taehwa Bridge water level'}]});assert.ok(result.tools.includes('get_water_level_prediction'));assert.ok(!result.tools.includes('get_weather_forecast'));assert.deepEqual(result.station_ids,[207]);assert.equal(calls.length,2);
});
test('future wind query returns wind rather than temperature',async()=>{
 const db={execute:async(sql)=>{if(sql.includes('FROM stations'))return [[{station_id:31,station_name:'Ulsan',data_source:'KMA'}]];return [[{issued_at:'2026-11-07 11:00:00',valid_at:'2026-11-08 00:00:00',wind_speed_forecast:5.2,temperature_forecast:12,source:'KMA'}]];}};
 const result=await require('../assistant-core').answer('Ulsan wind forecast tomorrow',{db,now:Date.parse('2026-11-07T12:00:00+09:00')});assert.match(result.answer,/5.2 m\/s/);assert.doesNotMatch(result.answer,/12 °C/);assert.equal(result.evidence[0].metric,'wind_speed_forecast');
});
test('invalid rain sentinels and impossible percentages are withheld',()=>{const {evidence}=require('../assistant-core'),s={station_id:31,station_name:'Ulsan'};assert.equal(evidence(s,'hourly_rainfall',-9,'mm',null,'KMA').status,'INVALID');assert.equal(evidence(s,'humidity',105,'%',null,'KMA').value,null);assert.equal(evidence(s,'temperature',-9,'°C',null,'KMA').value,-9);});
test('explicit name and project are recalled without measurement queries',async()=>{const r=await require('../assistant-core').answer('What is my name and what project am I working on?',{previous:[{role:'user',content:'My name is Nishan. My project is Rivora.'}],db:{execute(){assert.fail();}}});assert.match(r.answer,/Nishan/);assert.match(r.answer,/Rivora/);});
test('assistant text does not create personal memory',()=>{const {recall}=require('../assistant-recall');assert.match(recall('What is my name?',[{role:'assistant',content:'My name is Someone'}]),/recent messages/);});
test('local endpoint cannot redirect chat messages to another host',()=>{const {localAddress}=require('../local-assistant');assert.equal(localAddress({LLM_LOCAL_BASE_URL:'http://localhost:11435'}),'http://127.0.0.1:11435');assert.throws(()=>localAddress({LLM_LOCAL_BASE_URL:'https://example.com'}));assert.throws(()=>localAddress({LLM_LOCAL_BASE_URL:'http://127.0.0.1:11435/private?key=hidden'}));});
test('historical warning questions read bulletins, not a current risk guess',async()=>{
 const db={execute:async(sql)=>{if(sql.includes('FROM stations'))return [[{station_id:207,station_name:'Taehwa Bridge',external_station_id:'2201670',data_source:'RIVER_GAUGE'}]];assert.ok(sql.includes('hr_flood_warning_history'));return [[]];}};
 const r=await require('../assistant-core').answer('Taehwa Bridge warning yesterday',{db});assert.match(r.answer,/archive is incomplete; this does not establish/);assert.doesNotMatch(r.answer,/Low|Current flood-risk/);
});
test('concept explanations stay focused on the requested metric',()=>{const {explain}=require('../assistant-concepts');assert.match(explain('Explain RMSE'),/root mean squared/);assert.doesNotMatch(explain('Explain MAE'),/advisory/);});
test('presentation help remains conversational when project name is mentioned',()=>{const {intent}=require('../assistant-core');assert.equal(intent('Hi, my name is Alex. My project is Rivora. Can you help me prepare a presentation?'),'casual');assert.equal(intent('How does Rivora work?'),'project');});
