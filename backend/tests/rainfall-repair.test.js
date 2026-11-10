const test=require('node:test'),assert=require('node:assert/strict');
const {ensureRecentRain}=require('../hrfco-feature-history');
test('rainfall repair preserves genuine zero hours and skips a complete window',async()=>{
 const oldKey=process.env.HRFCO_SERVICE_KEY,oldFetch=global.fetch;process.env.HRFCO_SERVICE_KEY='a'.repeat(32);let requests=0;
 global.fetch=async()=>{requests++;throw Error('SHOULD_NOT_FETCH')};
 const rows=Array.from({length:24},(_,i)=>({observed_at:`2026-11-07 ${String(23-i).padStart(2,'0')}:00:00`,hourly_rainfall:0}));
 const db={query:async()=>[[]],execute:async(sql)=>sql.includes('hr_rainfall_links')?[[{rainfall_station_code:'22014080',distance_km:0.03}]]:[rows]};
 try{await ensureRecentRain(db,987654,'2026-11-07 23:40:00');assert.equal(requests,0)}finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.HRFCO_SERVICE_KEY;else process.env.HRFCO_SERVICE_KEY=oldKey}
});
test('72h ML repair does not stop merely because the last 24 rainfall hours are complete',async()=>{const oldKey=process.env.HRFCO_SERVICE_KEY,oldFetch=global.fetch;process.env.HRFCO_SERVICE_KEY='b'.repeat(32);let requests=0;const end=Date.parse('2026-11-09T00:00:00+09:00');const rows=Array.from({length:24},(_,i)=>({observed_at:new Date(end-i*3600000+9*3600000).toISOString().slice(0,19).replace('T',' '),hourly_rainfall:0}));const db={query:async()=>[[]],execute:async sql=>sql.includes('hr_rainfall_links')?[[{rainfall_station_code:'22014080',distance_km:1}]]:[rows]};global.fetch=async()=>{requests++;return {ok:true,json:async()=>({content:[]})}};try{await ensureRecentRain(db,987655,'2026-11-09 00:00:00',{hours:72});assert.equal(requests,1);}finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.HRFCO_SERVICE_KEY;else process.env.HRFCO_SERVICE_KEY=oldKey}});
