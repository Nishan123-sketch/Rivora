const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../assistant-core'),{identityAnswer,systemIdentity}=require('../assistant-identity');
const noDb={execute(){assert.fail('Application identity must not need a database or local model.');}};
for(const q of ['Who developed Rivora?','Who created you?','Who is your developer?','Who made this project?','Was Rivora developed by Alibaba Cloud?','Who is Nishan?','Who are you?','What is your name?','who is your devloper?'])test('application identity: '+q,async()=>{const r=await core.answer(q,{db:noDb,language:'en'});assert.equal(r.mode,'PROJECT_IDENTITY');assert.match(r.answer,/Nishan/);assert.doesNotMatch(r.answer,/developed by Alibaba/i);assert.equal(r.evidence.length,0);});
test('model authorship is not silently replaced with project authorship',()=>assert.equal(identityAnswer('Who developed Qwen?'),null));
test('casual brainstorming does not accidentally match rainfall substring',()=>{assert.equal(core.intent('Can we brainstorm ideas?'),'casual');assert.equal(core.intent('I want to explain my training routine'),'casual');});
test('real conditions still use data routing after typo normalization',()=>{assert.equal(core.intent('Ulsan weatehr tomorrow'),'data');assert.equal(core.intent('Taehwa Bridge current water level'),'data');});
test('urgent danger takes priority over identity',async()=>{const r=await core.answer('Who developed Rivora? I am trapped in floodwater',{db:noDb,language:'en'});assert.equal(r.mode,'EMERGENCY_GUIDANCE');assert.match(r.answer,/119/);});
test('shared model identity distinguishes app developer from model provider',()=>{assert.match(systemIdentity,/Nishan/);assert.match(systemIdentity,/separate/);});

test('unrelated authorship is not attributed to Nishan',()=>assert.equal(identityAnswer('Who made this recipe?'),null));
test('unrelated personal objects and Nishan projects do not invent app authorship',()=>{assert.equal(identityAnswer('Who made your coffee?'),null);assert.equal(identityAnswer('Who created your drawing?'),null);assert.equal(identityAnswer('Nishan built a robot?'),null);});
test('your app remains an application identity question',()=>assert.match(identityAnswer('Who built your app?'),/Nishan/));
test('provider sends application identity exactly once',async()=>{const {systemIdentity}=require('../assistant-identity'),{callProvider}=require('../chat-routes');let sent;const fetcher=async(_url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({message:{content:'Hello.'}})};};await callProvider(systemIdentity+' Be brief.',[{role:'user',content:'hello'}],undefined,fetcher,{LLM_PROVIDER:'ollama'});assert.equal(sent.messages[0].content.split(systemIdentity).length-1,1);});
