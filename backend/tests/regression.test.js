const {test,after} = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const {calculateWindow} = require('../rainfall-analysis');
const {analyzeRiver} = require('../river-analysis');
const app = require('../server');
const original = {query:pool.query,execute:pool.execute};
after(async()=>{Object.assign(pool,original);await pool.end()});
const hour = 3600000;
const kst = ms => new Date(ms+9*hour).toISOString().slice(0,19).replace('T',' ');
const latest = Math.floor(Date.now()/hour)*hour;
test('complete rainfall windows, true zero, missing hour, invalid measurement',()=>{
 const rows=Array.from({length:7},(_,i)=>({observed_at:`2026-10-30 ${String(i+5).padStart(2,'0')}:00:00`,hourly_rainfall:i?0:null,rainfall_day:i}));
 assert.equal(calculateWindow(rows,6).rainfallMm,0);
 rows[3].observed_at='2026-10-30 08:30:00';
 assert.equal(calculateWindow(rows,6).rainfallMm,null);
 assert.equal(calculateWindow([],6).status,'INSUFFICIENT_DATA');
});
test('KST freshness and explicit threshold verification gate',async()=>{
 let verified='UNVERIFIED';let stale=false;
 pool.execute=async sql=>{
  if(sql.includes('FROM stations'))return [[{station_id:207,external_station_id:'2201670'}]];
  if(sql.includes('FROM flood_thresholds'))return [[{interest_level_m:1,caution_level_m:2,alert_level_m:3,severe_level_m:4,verification_status:verified,source_url:'https://example.test/reference',verified_at:'2026-10-01'}]];
  return [[{observed_at:kst(latest-(stale?5:0)*hour),water_level:'2.5'}]];
 };
 assert.equal((await analyzeRiver()).risk_status,'STAGE_THRESHOLDS_UNAVAILABLE');
 verified='VERIFIED';assert.equal((await analyzeRiver()).risk_level,'CAUTION');
 stale=true;assert.equal((await analyzeRiver()).risk_status,'STALE_OBSERVATION');
});
test('HTTP route validation, KST history SQL, gauge inclusion and alert counts',async()=>{
 let historySql='';let waterSql='';
 pool.execute=async sql=>{
  if(sql.includes('COUNT(*)'))return [[{count:'0'}]];
  if(sql.includes('FROM alerts'))return [[]];
  if(sql.includes('FROM stations'))return [[{station_id:207}]];
  if(sql.includes('DATE_SUB'))historySql=sql;
  if(sql.includes('JOIN stations'))waterSql=sql;
  return [[]];
 };
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
  assert.equal((await fetch(base+'/api/rivers/abc/history')).status,400);
  assert.equal((await fetch(base+'/api/rivers/207/history?hours=169')).status,400);
  assert.equal((await fetch(base+'/api/rivers/207/history')).status,200);
  assert.match(historySql,/INTERVAL 9 HOUR/);
  assert.equal((await fetch(base+'/api/water/latest')).status,200);
  assert.match(waterSql,/RIVER_GAUGE/);
  const alerts=await (await fetch(base+'/api/alerts')).json();assert.equal(alerts.count,0);
 }finally{await new Promise(r=>server.close(r))}
});
test('combined rainfall contract returns numeric totals, not objects',async()=>{
 pool.query=async sql=>{
  if(sql.includes('FROM stations'))return [[{station_id:31,station_name:'Ulsan'}]];
  if(sql.includes('FROM weather_forecasts'))return [[]];
  if(sql.includes('FROM aws_rainfall_readings'))return [[]];
  return [Array.from({length:25},(_,i)=>({observed_at:kst(latest-i*hour),rainfall_day:24-i,hourly_rainfall:1,rainfall:1}))];
 };
 pool.execute=async sql=>sql.includes('FROM weather_readings')?pool.query(sql):sql.includes('FROM stations')?[[{station_id:207}]]:[[]];
 const {analyzeCombinedConditions}=require('../combined-analysis');
 const result=await analyzeCombinedConditions();
 assert.equal(result.weather.rainfall_6h,6);
 assert.equal(typeof result.weather.rainfall_1h,'number');
});
test('authentication login and verified-account preference persistence',async()=>{
 const bcrypt=require('bcrypt');process.env.JWT_SECRET='test-only-secret-with-at-least-32-characters';
 const hash=await bcrypt.hash('test-password-123',4);let saved=false;
 pool.execute=async(sql,args)=>{
  if(sql.includes('FROM users'))return [[{user_id:7,email:'test@example.test',password_hash:hash,email_verified_at:'2026-10-01'}]];
  if(sql.includes('FROM stations'))return [[{station_id:207}]];
  if(sql.includes('INSERT INTO user_alert_preferences')){saved=true;assert.deepEqual(args,[7,207,false,true]);return [{affectedRows:1}]}
  return [[]];
 };
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/alert-preferences')).status,401);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.test',password:'test-password-123'})});
  assert.equal(login.status,200);const {token}=await login.json();assert.ok(token);
  const r=await fetch(base+'/api/alert-preferences',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({station_id:207,weather_enabled:false,flood_enabled:true})});
  assert.equal(r.status,200);assert.equal(saved,true);
 }finally{await new Promise(r=>server.close(r))}
});
test('a failed rainfall component does not hide river and forecast results',async()=>{
 pool.query=async()=>{throw new Error('Simulated database component failure')};
 pool.execute=async sql=>sql.includes('FROM weather_readings')?pool.query(sql):sql.includes('FROM stations')?[[{station_id:207}]]:[[]];
 const result=await require('../combined-analysis').analyzeCombinedConditions();
 assert.equal(result.weather.rainfall_6h,null);
 assert.ok(result.component_errors.some(e=>e.component==='rainfall'));
 assert.ok(result.assessment);
});
test('frontend KST parser is independent of host timezone',async()=>{
 const {parseTime}=await import('../../frontend/src/lib/time.js');
 assert.equal(parseTime('2026-10-31 12:00:00').toISOString(),'2026-10-31T03:00:00.000Z');
 assert.equal(parseTime('2026-10-31T03:00:00Z').toISOString(),'2026-10-31T03:00:00.000Z');
 assert.ok(Number.isNaN(parseTime('').getTime()));
});
