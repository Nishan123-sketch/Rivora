const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {smtpConfig}=require('../email-service');
const {readiness}=require('../check-readiness');

test('SMTP configuration uses explicit credentials and supports standard 465/587 ports without sending',()=>{
  assert.throws(()=>smtpConfig({}),/not configured/);
  const dummy={SMTP_HOST:'smtp.example.test',SMTP_USER:'fake@example.test',SMTP_APP_PASSWORD:'not-a-real-password'};
  const secure=smtpConfig(dummy);
  assert.equal(secure.port,465);assert.equal(secure.secure,true);
  const tls=smtpConfig({...dummy,SMTP_PORT:'587'});
  assert.equal(tls.secure,false);
  assert.equal(tls.port,587);
  assert.throws(()=>smtpConfig({...dummy,SMTP_PORT:'bad'}),/Invalid SMTP_PORT/);
});

test('readiness works with a fake database, reports counts, never prints secrets',async()=>{
  const db={async execute(sql){if(sql.includes('DATABASE()'))return [[{database_name:'sample_test_database'}]];return [[{n:0}]];}};
  const result=await readiness({db,env:{JWT_SECRET:'do-not-print-this',KMA_API_KEY:'do-not-print-this'}});
  assert.equal(result.database,'CONNECTED');
  assert.equal(result.linked_rivers,0);
  assert.equal(result.recent_weather_stations,0);
  assert.equal(result.alerts_enabled,false);
  assert.equal(result.email_delivery_configured,false);
  assert.doesNotMatch(JSON.stringify(result),/do-not-print-this/);
  assert.equal(result.checks.length,6);
});

test('migration includes OTP cooldown timestamp, durable email send status, precipitation ranges',()=>{
  const migration=fs.readFileSync(path.join(__dirname,'../migrate.js'),'utf8');
  assert.match(migration,/email_verification_tokens:\s*\{created_at:/);
  assert.match(migration,/attempt_count:/);
  assert.match(migration,/ENUM\('queued','sending','sent','failed'\)/);
  assert.match(migration,/precipitation_max_exclusive/);
  const verify=fs.readFileSync(path.join(__dirname,'../email-verification.js'),'utf8');
  assert.match(verify,/attempts, created_at/);
  assert.match(verify,/UTC_TIMESTAMP\(\)\s*\)`/);
});
