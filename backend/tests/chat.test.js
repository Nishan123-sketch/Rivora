const {test}=require('node:test');
const assert=require('node:assert/strict');
const {timeRequest}=require('../chat-context');
const {callProvider,systemPrompt}=require('../chat-routes');
test('date/time retrieval resolves KST, noon/midnight and rejects invalid dates',()=>{
 const now=new Date('2026-11-02T16:00:00Z');
 assert.equal(timeRequest('weather at 2 PM today',now).at,'2026-11-03 14:00:00');
 assert.equal(timeRequest('12 AM yesterday',now).at,'2026-11-02 00:00:00');
 assert.equal(timeRequest('2026-10-01 14:30',now).at,'2026-10-01 14:30:00');
 assert.throws(()=>timeRequest('2026-02-30',now));assert.match(systemPrompt({}),/Asia\/Seoul/);
});
test('all provider adapters pass system context and conversation',async()=>{
 for(const provider of ['ollama','openai','gemini']){
  let body;
  const fetcher=async(url,options)=>{
   body=JSON.parse(options.body);
   return {ok:true,json:async()=>({message:{content:'grounded'},choices:[{message:{content:'grounded'}}],candidates:[{content:{parts:[{text:'grounded'}]}}]})};
  };
  const answer=await callProvider('database context',[{role:'user',content:'question'}],undefined,fetcher,{LLM_PROVIDER:provider,OPENAI_API_KEY:'fixture',GEMINI_API_KEY:'fixture'});
  assert.equal(answer,'grounded');assert.ok(JSON.stringify(body).includes('database context'));
 }
});
test('provider failures are explicit',async()=>{await assert.rejects(()=>callProvider('',[],undefined,async()=>({ok:false,status:429}),{LLM_PROVIDER:'ollama'}),/HTTP 429/);});
