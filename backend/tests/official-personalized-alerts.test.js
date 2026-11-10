const {test}=require('node:test'),assert=require('node:assert/strict');
const {officialWarning,enqueueOfficialWarnings}=require('../unified-alerts');
const {processUnifiedEmailQueue}=require('../unified-email-queue');
const now=Date.parse('2026-11-09T10:00:00+09:00'),event={event_id:'a'.repeat(64),action:'ISSUE',severity:'WARNING',issued_at:'2026-11-09 09:50:00'};
const station={station_id:207,station_name:'Taehwa Bridge',external_station_id:'2201670'};
const warning={station,event,status:'WARNING',as_of:'2026-11-09 10:00:00',source_url:'https://www.hrfco.go.kr/'};
const coverage={status:'COMPLETE',initial_state:'NONE',start_at:'2026-11-09 09:00:00',end_at:'2026-11-09 10:00:00',checked_at:'2026-11-09 01:00:00',source_url:'https://www.hrfco.go.kr/'};
test('official notifications require fresh complete coverage, an issuance and exact verified station identity',async()=>{
 for(const [cover,events,expected]of [[coverage,[event],true],[{...coverage,status:'PARTIAL'},[event],false],[{...coverage,checked_at:'2026-11-08 01:00:00'},[event],false],[{...coverage,evidence:'{"live_status_blocked":true}'},[event],false],[coverage,[event,{...event,action:'CANCEL',issued_at:'2026-11-09 09:55:00'}],false]]){
  const db={execute:async(sql,args)=>{if(sql.includes('FROM stations s'))return [[station]];if(sql.includes('ml_source_coverage')){assert.deepEqual(args,['2201670']);return [[cover]];}if(sql.includes('hr_flood_warning_history')){assert.equal(args[0],'2201670');return [events];}throw Error(sql);}};
  assert.equal(Boolean(await officialWarning(db,207,now)),expected);
 }
});
test('exact-station opted-in verified recipients only, with one alert and one queued delivery across repeated ticks',async()=>{
 let alert=null,created=0;const queued=new Set();
 const preferences=[{user:1,station:207,enabled:true,verified:true},{user:2,station:208,enabled:true,verified:true},{user:3,station:207,enabled:false,verified:true},{user:4,station:207,enabled:true,verified:false}];
 const c={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},execute:async(sql,args)=>{
  if(sql.startsWith('SELECT station_id'))return [[station]];
  if(sql.startsWith('SELECT alert_id'))return [alert?[alert]:[]];
  if(sql.startsWith('INSERT INTO alerts')){created++;alert={alert_id:5};return [{insertId:5}];}
  if(sql.includes('INSERT IGNORE INTO email_notifications')){assert.match(sql,/p.station_id=\?/);assert.ok(!sql.includes('river_gauge_links'));for(const p of preferences)if(p.station===args[1]&&p.enabled&&p.verified)queued.add(args[0]+':'+p.user);return [{}];}throw Error(sql);
 }};
 const db={execute:async()=>[[{station_id:207}]],getConnection:async()=>c};
 assert.equal(await enqueueOfficialWarnings({db,now,getOfficialWarning:async()=>warning}),1);assert.equal(await enqueueOfficialWarnings({db,now,getOfficialWarning:async()=>warning}),0);assert.equal(created,1);assert.deepEqual([...queued],['5:1']);
});
test('mock transport receives no unrelated, unknown, project or duplicate emails; opt-out is rechecked at claim',async()=>{
 const env={ENABLE_AUTOMATIC_ALERTS:'true',ENABLE_ALERT_EMAILS:'true',ALERT_DRY_RUN:'false',SMTP_HOST:'mock',SMTP_USER:'mock',SMTP_APP_PASSWORD:'mock',JWT_SECRET:'synthetic-test-secret-1234567890123456789'};
 for(const mode of ['official','unknown','project','optout']){let status='queued',sent=0;const message=mode==='project'?'[Project advisory] test':`[Official warning:${event.event_id}] test`;
  const db={execute:async(sql)=>{if(sql.includes('SELECT DISTINCT')){assert.match(sql,/p.station_id=a.station_id/);assert.ok(!sql.includes('river_gauge_links'));return [[{notification_id:5,user_id:1,email:'synthetic@example.test',station_id:207,message_text:message}]];}if(sql.includes("SET status='sending'")){assert.match(sql,/p.flood_enabled=1/);if(status!=='queued'||mode==='optout')return [{affectedRows:0}];status='sending';return [{affectedRows:1}];}if(sql.includes("SET status='sent'")){status='sent';return [{}];}throw Error(sql);}};
  const options={db,env,now:()=>now,getOfficialWarning:async()=>mode==='unknown'?null:warning,sendEmail:async(to,subject,body)=>{assert.equal(to,'synthetic@example.test');assert.match(subject,/verified official/);assert.match(body,/Unsubscribe/);sent++;return 'mock-id';},logger:{error(){}}};
  await processUnifiedEmailQueue(options);await processUnifiedEmailQueue(options);assert.equal(sent,mode==='official'?1:0);
 }
});
