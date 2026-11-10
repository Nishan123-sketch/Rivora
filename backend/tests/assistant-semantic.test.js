const {test}=require('node:test'),assert=require('node:assert/strict');
const {validatePlan,semanticPlan,plannedQuestion,candidateChoice}=require('../assistant-followups');
const {savedMonitoringLocation}=require('../assistant-v2-routes');
test('semantic tool decisions are allowlisted; invented entities and SQL are rejected',()=>{
 const messages=[{role:'user',content:"How's Taehwa Bridge doing?"}];
 const p=validatePlan({tool:'latest_level',station:'Taehwa Bridge',answer:''},messages);
 assert.match(plannedQuestion(p,messages[0].content),/current water level/);
 for(const bad of [{...p,tool:'run_sql'},{...p,station:'Seoul'},{...p,sql:'DROP TABLE users'}])assert.throws(()=>validatePlan(bad,messages));
});
test('semantic interpretation receives compact current conversation, not unrelated old turns',async()=>{
 const messages=Array.from({length:10},(_,i)=>({role:i%2?'assistant':'user',content:'message '+i}));
 messages.push({role:'user',content:'pls taehwa update'});
 const result=await semanticPlan(messages,async(system,context)=>{assert.equal(context.length,1);assert.equal(context[0].content,'pls taehwa update');assert.ok(!context.some(m=>m.content==='message 0'));return '{"tool":"clarify","station":"","answer":"Which station?"}';});assert.equal(result.tool,'clarify');
});
test('saved monitoring retrieval binds authenticated ownership and ignores client identity',async()=>{
 let args,next=false;const middleware=savedMonitoringLocation({auth:(req,res,done)=>{req.user={user_id:7};return done();},db:{execute:async(sql,a)=>{args=a;return [[{station_id:207}]];}}});
 const req={body:{user_id:99,messages:[{role:'user',content:'My monitoring location water level'}]}};
 await middleware(req,{},()=>{next=true;});assert.deepEqual(args,[7]);assert.equal(req.body.station_id,207);assert.ok(next);
});
test('guest personal-location retrieval cannot access preferences',async()=>{
 let denied=false;const middleware=savedMonitoringLocation({auth:()=>{denied=true;},db:{execute(){assert.fail('Private data must not be queried');}}});
 await middleware({body:{messages:[{role:'user',content:'My saved location rainfall'}]}},{},()=>assert.fail());assert.ok(denied);
});
test('other bridge does not guess among multiple clarification candidates',()=>assert.deepEqual(candidateChoice('no, the other bridge',[{station_id:1},{station_id:2}]),{needs_clarification:true}));
test('local schema grammar and token limits are passed to the existing adapter',()=>{
 const {providerRequest}=require('../chat-stream'),schema=require('../assistant-followups').semanticSchema;
 const r=providerRequest('Interpret safely',[{role:'user',content:'Taehwa update'}],{LLM_PROVIDER:'llamacpp',LLM_LOCAL_CONTEXT:'2048'},{maxTokens:96,temperature:0,responseSchema:schema});
 assert.equal(r.body.max_tokens,96);assert.equal(r.body.temperature,0);assert.deepEqual(r.body.response_format.json_schema.schema,schema);assert.equal(r.body.response_format.json_schema.strict,true);
});

test('database outages are reported separately from provider failures',async()=>{
 const {createHandler}=require('../assistant-v2-routes'),{EventEmitter}=require('events');let payload,status;const res=new EventEmitter();res.status=n=>{status=n;return res;};res.json=p=>{payload=p;res.writableEnded=true;};
 await createHandler({answer:async()=>{throw Object.assign(Error('connection refused'),{code:'ECONNREFUSED'});},provider:()=>assert.fail('Database outage must not trigger model calls')})({path:'/chat',body:{messages:[{role:'user',content:'Taehwa water level'}]}},res);
 assert.equal(status,503);assert.equal(payload.code,'DATA_RETRIEVAL_UNAVAILABLE');assert.match(payload.message,/database/);
});
