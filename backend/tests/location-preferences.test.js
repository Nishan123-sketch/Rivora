const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createRouter}=require('../preference-routes');
const {locationRows}=require('../monitoring-locations');
test('location labels require sourced administrative metadata, never geographic guesses',()=>{
 const rows=locationRows([{station_id:207,station_code:'2201670',station_name:'태화교'},{station_id:9,station_code:'9999999',station_name:'Unknown'}],new Map([['2201670',{province:'Ulsan',district:'Jung-gu'}]]));
 assert.equal(rows[0].province,'Ulsan');assert.equal(rows[1].province,'Administrative area unavailable');assert.doesNotMatch(rows[0].station_name,/[가-힣]/);
});
test('authenticated preferences validate identity, replace atomically, and support opt-out',async()=>{
 const writes=[];let committed=0;const c={beginTransaction:async()=>{},commit:async()=>{committed++;},rollback:async()=>{},release(){},execute:async(sql,args)=>{writes.push({sql,args});return [[]];}};
 const db={execute:async(sql,args)=>{if(sql.includes('FROM stations s')){assert.match(sql,/verification_status='VERIFIED'/);return [args[0]===207?[{station_id:207}]:[]];}assert.deepEqual(args,[7]);return [[]];},getConnection:async()=>c};
 const app=express();app.use(express.json());app.use(createRouter({db,auth:(req,res,next)=>{req.user={user_id:7,email_verified:req.headers['test-unverified']!=='true'};next();},catalog:async()=>[{station_id:207}]}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/alert-preferences`;
 try{
  for(const consent of [true,false]){const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({station_id:207,weather_enabled:false,flood_enabled:consent,replace_existing:true})});assert.equal(r.status,200);assert.deepEqual(writes.at(-1).args,[7,207,false,consent]);}
  assert.equal(committed,2);assert.ok(writes.filter(w=>w.sql.startsWith('DELETE')).every(w=>w.args[0]===7));
  for(const [body,headers,status] of [[{station_id:207,weather_enabled:false,flood_enabled:true,user_id:8},{},400],[{station_id:999,weather_enabled:false,flood_enabled:true},{},400],[{station_id:207,weather_enabled:false,flood_enabled:true},{'test-unverified':'true'},403]]){const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});assert.equal(r.status,status);}
  assert.equal(committed,2);assert.equal((await fetch(url)).status,200);
 }finally{await new Promise(r=>server.close(r));}
});
