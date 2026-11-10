const {test}=require('node:test'),assert=require('node:assert/strict');
const {streamAnthropic}=require('../anthropic-provider');
const {createExecutor}=require('../chat-tools');
const {createAccount}=require('../register-account');
test('Anthropic streaming completes a real tool-result round trip with fragmented SSE',async()=>{
 const requests=[],calls=[];let round=0;const enc=new TextEncoder();
 const events=values=>values.map(v=>'data: '+JSON.stringify(v)+'\n\n').join('');
 const first=events([{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool-1',name:'get_risk',input:{}}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"id":207}'}},{type:'message_delta',delta:{stop_reason:'tool_use'}}]);
 const last=events([{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'No assessable risk; history is insufficient.'}},{type:'message_delta',delta:{stop_reason:'end_turn'}}]);
 const fetcher=async(url,options)=>{requests.push(JSON.parse(options.body));const text=round++?last:first;return {ok:true,body:(async function*(){yield enc.encode(text.slice(0,37));yield enc.encode(text.slice(37));})()};};
 let answer='';for await(const piece of streamAnthropic('Never invent values',[{role:'user',content:'Taehwa risk?'}],undefined,{env:{ANTHROPIC_API_KEY:'fake',LLM_MODEL:'test-model'},fetcher,execute:async(name,input)=>{calls.push({name,input});return {level:null,data_status:'INSUFFICIENT_HISTORY'};}}))answer+=piece;
 assert.match(answer,/insufficient/);assert.deepEqual(calls,[{name:'get_risk',input:{id:207}}]);assert.equal(requests[1].messages.at(-1).content[0].tool_use_id,'tool-1');assert.ok(requests[0].tools.some(t=>t.name==='system_overview'));
});
test('tool executor rejects unknown tools and invalid IDs before database access',async()=>{const execute=createExecutor({db:{execute(){throw Error('Database should not run');}},getUnified:async()=>[]});await assert.rejects(execute('delete_users',{}),/Unknown tool/);await assert.rejects(execute('get_risk',{id:'207 OR 1=1'}),/Invalid id/);});
test('registration stores account and river preference atomically, rolling back preference failure',async()=>{
 for(const fail of [false,true]){const state={committed:false,rolled:false,preference:null};const connection={beginTransaction:async()=>{},commit:async()=>{state.committed=true;},rollback:async()=>{state.rolled=true;},release(){},execute:async(sql,args)=>{if(sql.includes('SELECT station_id'))return [[{station_id:207}]];if(sql.includes('INSERT INTO users'))return [{insertId:15}];if(sql.includes('INSERT INTO user_alert_preferences')){if(fail)throw Error('Preference write failed');state.preference=args;return [{affectedRows:1}];}throw Error('Unexpected SQL');}};
 const work=createAccount({email:'synthetic@example.test',passwordHash:'fake',stationId:207,consent:true},{getConnection:async()=>connection});if(fail){await assert.rejects(work,/Preference write failed/);assert.equal(state.rolled,true);assert.equal(state.committed,false);}else{await work;assert.equal(state.committed,true);assert.deepEqual(state.preference,[15,207,true]);}}
});
