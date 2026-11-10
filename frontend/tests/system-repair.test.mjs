import {test} from 'node:test';import assert from 'node:assert/strict';
import {retryDelay,monitorConnection,connectionLabel} from '../src/lib/assistantConnection.js';
import {englishBulletin,englishText} from '../src/lib/englishDisplay.js';
import {appDataIndices} from '../src/lib/pageData.js';
import {conversationMessages} from '../src/lib/assistantConnection.js';

test('assistant sends per-conversation station candidates without unrelated metadata',()=>{
 const context={station_id:2912,candidates:[{station_id:2912,station_code:'1015636'}]};
 assert.deepEqual(conversationMessages([{role:'assistant',content:'Which station?',session_context:context,retrieved_at:'ignored'},{role:'user',content:'yes',session_context:{station_id:99}}]),[{role:'assistant',content:'Which station?',session_context:context},{role:'user',content:'yes'}]);
 assert.deepEqual(conversationMessages([{role:'user',content:'Hello'}]),[{role:'user',content:'Hello'}]);
});
test('bounded jittered retry stops on permanent failure and exhaustion',()=>{assert.equal(retryDelay(5),null);assert.equal(retryDelay(0,{status:401}),null);assert.equal(retryDelay(0,{retryable:false}),null);assert.equal(retryDelay(0,{},()=>.5),750);assert.ok(retryDelay(4,{},()=>1)<=12000);});
test('connection never overlaps, cleanup cancels subsequent checks',async()=>{let resolve,count=0;const states=[];const monitor=monitorConnection({fetcher:()=>{count++;return new Promise(r=>resolve=r)},onState:s=>states.push(s),visible:()=>true,schedule:()=>0,cancel:()=>{}});monitor.resume();assert.equal(count,1);resolve({ok:true,json:async()=>({conversational_model_ready:true})});await new Promise(r=>setTimeout(r,0));assert.equal(states[0].conversational_model_ready,true);monitor.dispose();monitor.resume();assert.equal(count,1);});
test('permanent status failure does not schedule endless reconnect',async()=>{let schedules=0;const m=monitorConnection({fetcher:async()=>({ok:false,status:401,json:async()=>({})}),onState:()=>{},visible:()=>true,schedule:()=>schedules++,cancel:()=>{}});await new Promise(r=>setTimeout(r,0));assert.equal(schedules,0);m.dispose();assert.doesNotMatch(connectionLabel({reason:'MODEL_FILES_MISSING'}),/reconnecting/);});
test('English bulletin and labels keep identifier and original string unchanged',()=>{const original='홍수예보 제 2025-37 호';assert.equal(englishBulletin(original),'Flood Forecast Bulletin No. 2025-37');assert.equal(original,'홍수예보 제 2025-37 호');assert.doesNotMatch(englishText('울산'),/[가-힣]/);});
test('assistant and station pages do not load unrelated weather and water feeds',()=>{assert.deepEqual(appDataIndices('AI Assistant'),[0]);assert.deepEqual(appDataIndices('Stations'),[]);});
test('non-JSON authentication error stops status retries before body parsing',async()=>{let schedules=0;const states=[];const monitor=monitorConnection({fetcher:async()=>({ok:false,status:401,json:async()=>{throw new SyntaxError('HTML error page')}}),onState:s=>states.push(s),visible:()=>true,schedule:()=>schedules++,cancel:()=>{}});await new Promise(r=>setTimeout(r,0));assert.equal(schedules,0);assert.equal(states[0].retryable,false);monitor.dispose();});
