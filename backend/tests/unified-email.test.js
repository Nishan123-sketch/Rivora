const {test}=require('node:test'),assert=require('node:assert/strict');
const {processUnifiedEmailQueue}=require('../unified-email-queue');
const observed_at=new Date(Date.now()+9*3600000).toISOString().slice(0,19).replace('T',' ');
const warning={station:{external_station_id:'2201670'},event:{event_id:'a'.repeat(64)},status:'WARNING',as_of:observed_at};
const notification={notification_id:10,user_id:1,station_id:207,email:'synthetic@example.test',message_text:'[Official warning:'+ 'a'.repeat(64)+'] SYNTHETIC TEST',severity:'High'};
const env={ENABLE_AUTOMATIC_ALERTS:'true',ENABLE_ALERT_EMAILS:'true',SMTP_HOST:'fake',SMTP_USER:'fake',SMTP_APP_PASSWORD:'fake',JWT_SECRET:'synthetic-test-unsubscribe-secret-123456789'};
const logger={info(){},error(){}};
test('dry-run never claims or sends eligible queued messages',async()=>{let claims=0,sent=0;const result=await processUnifiedEmailQueue({db:{execute:async sql=>{if(sql.includes('SELECT DISTINCT'))return [[notification]];claims++;throw Error('Unexpected claim');}},env,getOfficialWarning:async()=>warning,sendEmail:async()=>{sent++;},logger});assert.equal(result.status,'DRY_RUN');assert.equal(result.eligible,1);assert.equal(result.sent,0);assert.equal(claims,0);assert.equal(sent,0);});
test('an SMTP-accepted message with failed status persistence remains sending for manual review',async()=>{let failed=false,sent=0;const db={execute:async sql=>{if(sql.includes('SELECT DISTINCT'))return [[notification]];if(sql.includes("SET status='sending'"))return [{affectedRows:1}];if(sql.includes("SET status='sent'"))throw Error('Simulated persistence failure');if(sql.includes("SET status='failed'")){failed=true;return [{affectedRows:1}];}throw Error('Unexpected SQL');}};await processUnifiedEmailQueue({db,env:{...env,ALERT_DRY_RUN:'false'},getOfficialWarning:async()=>warning,sendEmail:async()=>{sent++;return 'synthetic-id';},logger});assert.equal(sent,1);assert.equal(failed,false);});
test('unknown official coverage do not claim or send a queued notification',async()=>{let sent=0;const result=await processUnifiedEmailQueue({db:{execute:async()=>[[notification]]},env:{...env,ALERT_DRY_RUN:'false'},getOfficialWarning:async()=>null,sendEmail:async()=>{sent++;},logger});assert.equal(result.eligible,0);assert.equal(sent,0);});
test('ambiguous SMTP failure is held for review rather than automatically duplicated',async()=>{
 let status='queued',attempts=0;
 const db={execute:async sql=>{if(sql.includes('SELECT DISTINCT'))return [[notification]];if(sql.includes("SET status='sending'")){if(status!=='queued')return [{affectedRows:0}];status='sending';return [{affectedRows:1}];}throw Error('Ambiguous delivery must not be made retryable');}};
 const options={db,env:{...env,ALERT_DRY_RUN:'false'},getOfficialWarning:async()=>warning,sendEmail:async()=>{attempts++;throw Error('Transport disconnected after possible acceptance');},logger};
 await processUnifiedEmailQueue(options);await processUnifiedEmailQueue(options);assert.equal(attempts,1);assert.equal(status,'sending');
});
