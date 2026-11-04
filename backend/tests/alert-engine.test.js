const test = require('node:test');
const assert = require('node:assert/strict');
const {createAlertWorker} = require('../automatic-alerts');
const {processEmailQueue, canSendAlertEmail} = require('../email-queue');

const verified = (overrides = {}) => ({
  station_id: 207, risk_status: 'ASSESSED', risk_level: 'CAUTION',
  data_freshness: {status:'FRESH'}, latest_water_level: 4.96,
  latest_observed_at: '2026-11-01 12:00:00', ...overrides
});
const enabled = {ENABLE_AUTOMATIC_ALERTS:'true',ENABLE_ALERT_EMAILS:'false'};

function fakeAlertDb() {
  const state = { active: [], created: [], queues: [], resolved:0, commits:0 };
  const connection = {
    async beginTransaction() {},
    async commit() {state.commits++},
    async rollback() {},
    release() {},
    async execute(sql,args) {
      if(sql.includes('FROM stations') && sql.includes('FOR UPDATE'))return [[{station_id:207}]];
      if(sql.includes('FROM alerts') && sql.includes('FOR UPDATE'))return [state.active];
      if(sql.includes('UPDATE alerts')){state.active=[];state.resolved++;return [{affectedRows:1}]}
      if(sql.includes('INSERT INTO alerts')){const id=state.created.length+1;state.created.push({id,severity:args[1],message:args[2]});state.active=[{alert_id:id,severity:args[1]}];return [{insertId:id}]}
      if(sql.includes('INSERT IGNORE INTO email_notifications')){state.queues.push(args);return [{affectedRows:1}]}
      throw Error('Unexpected connection SQL: '+sql);
    }
  };
  const db={
    async execute(sql) {if(sql.includes('FROM stations s JOIN river_gauge_links'))return [[{station_id:207,external_station_id:'2201670'}]];throw Error('Unexpected root SQL: '+sql)},
    async getConnection() {return connection}
  };
  return {db,state};
}

test('alerts DISABLED by default: never reads DB and never sends email', async () => {
  const worker=createAlertWorker({db:{execute(){throw Error('no DB query allowed')}},env:{},logger:{error(){}}});
  assert.deepEqual(await worker.evaluateAlerts(),{status:'DISABLED',assessed:0,created:0});
});

test('unverified and stale data cannot generate an alert or email', async () => {
  for (const observation of [verified({risk_status:'STAGE_THRESHOLDS_UNAVAILABLE'}),verified({data_freshness:{status:'STALE'}}),verified({latest_water_level:null})]) {
    const {db,state}=fakeAlertDb();
    const worker=createAlertWorker({db,env:enabled,analyzeRiver:async()=>observation, logger:{error(){}}});
    const output=await worker.evaluateAlerts();
    assert.equal(output.created,0);
    assert.equal(state.created.length,0);
    assert.equal(state.queues.length,0);
  }
});

test('verified fresh gauge creates exactly one labeled project alert and queues opt-in recipients',async()=>{
  const {db,state}=fakeAlertDb();
  const worker=createAlertWorker({db,env:enabled,analyzeRiver:async()=>verified(),logger:{error(){}}});
  assert.equal((await worker.evaluateAlerts()).created,1);
  assert.equal((await worker.evaluateAlerts()).created,0);
  assert.equal(state.created.length,1);
  assert.equal(state.queues.length,1);
  assert.match(state.created[0].message,/Educational project assessment only\. NOT an official flood warning/);
  assert.equal(state.created[0].severity,'Moderate');
});

test('NORMAL verified fresh gauge resolves only project advisories; no new warning created',async()=>{
  const {db,state}=fakeAlertDb();
  state.active=[{alert_id:2,severity:'High'}];
  const worker=createAlertWorker({db,env:enabled,analyzeRiver:async()=>verified({risk_level:'NORMAL'}),logger:{error(){}}});
  assert.equal((await worker.evaluateAlerts()).created,0);
  assert.equal(state.created.length,0);
  assert.equal(state.resolved,1);
});

test('outgoing emails require BOTH alert + email opt-in and SMTP configuration',()=>{
  assert.equal(canSendAlertEmail({ENABLE_AUTOMATIC_ALERTS:'true',ENABLE_ALERT_EMAILS:'true'}),false);
  assert.equal(canSendAlertEmail({ENABLE_AUTOMATIC_ALERTS:'false',ENABLE_ALERT_EMAILS:'true',SMTP_HOST:'host',SMTP_USER:'user',SMTP_APP_PASSWORD:'pass'}),false);
  assert.equal(canSendAlertEmail({ENABLE_AUTOMATIC_ALERTS:'true',ENABLE_ALERT_EMAILS:'true',SMTP_HOST:'host',SMTP_USER:'user',SMTP_APP_PASSWORD:'pass'}),true);
});

function fakeEmailDb() {
  const state={status:'queued',attempt_count:0,attempted_at:null,reference:null};
  const db={async execute(sql,args){
    if(sql.includes('SELECT n.notification_id'))return [[{notification_id:5,email:'synthetic@example.test',message_text:'[Project advisory] fake threshold TEST ONLY',severity:'Moderate'}]];
    if(sql.includes("SET status='sending'")){
      if(!['queued','failed'].includes(state.status)||state.attempt_count>=3)return [{affectedRows:0}];
      state.status='sending';state.attempt_count++;return [{affectedRows:1}];
    }
    if(sql.includes("SET status='sent'")){state.status='sent';state.reference=args[0];return [{affectedRows:1}]}
    if(sql.includes("SET status='failed'")){state.status='failed';return [{affectedRows:1}]}
    throw Error('Unexpected mail SQL: '+sql);
  }};
  return {db,state};
}
const smtp = {ENABLE_AUTOMATIC_ALERTS:'true',ENABLE_ALERT_EMAILS:'true',SMTP_HOST:'fake',SMTP_USER:'fake',SMTP_APP_PASSWORD:'fake'};

test('success marks queued notification sent only after fake SMTP returns message ID',async()=>{
  const {db,state}=fakeEmailDb();let called=0;
  const result=await processEmailQueue({db,env:smtp,sendEmail:async(to,subject,body)=>{called++;assert.equal(to,'synthetic@example.test');assert.match(subject,/UNOFFICIAL/);assert.match(body,/not an official emergency warning/);return 'fake-message-id';},logger:{error(){}}});
  assert.equal(result.sent,1);assert.equal(called,1);assert.equal(state.status,'sent');assert.equal(state.reference,'fake-message-id');
});

test('SMTP failure becomes failed, never sent; a claimed job cannot be duplicated',async()=>{
  const {db,state}=fakeEmailDb();
  const result=await processEmailQueue({db,env:smtp,sendEmail:async()=>{throw Error('Fake SMTP failure')},logger:{error(){}}});
  assert.equal(result.failed,1);assert.equal(state.status,'failed');assert.equal(state.attempt_count,1);
  state.status='sending';
  let called=false;
  const second=await processEmailQueue({db,env:smtp,sendEmail:async()=>{called=true},logger:{error(){}}});
  assert.equal(second.sent,0);assert.equal(called,false);
});
