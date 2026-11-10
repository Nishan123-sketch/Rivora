const {test}=require('node:test'),assert=require('node:assert/strict');
const {answer}=require('../assistant-core');
const now=Date.parse('2026-11-09T09:30:00+09:00');
function fixture(weatherRain,awsRain){
 const calls=[];
 return {calls,async execute(sql,args){
  calls.push({sql,args});
  if(sql.includes('FROM stations'))return [[{station_id:31,station_name:'Ulsan',external_station_id:'152',data_source:'KMA'}]];
  if(sql.includes('FROM weather_readings'))return [[{observed_at:'2026-11-09 09:00:00',temperature:11.1,hourly_rainfall:weatherRain}]];
  if(sql.includes('FROM aws_rainfall_readings')){assert.deepEqual(args,['152']);return [awsRain===undefined?[]:[{observed_at:'2026-11-09 08:00:00',hourly_rainfall:awsRain,aws_station_code:'152'}]];}
  throw Error('Unexpected query: '+sql);
 }};
}
test('Ulsan uses genuine own-station AWS zero with its original timestamp',async()=>{
 const r=await answer('Ulsan rainfall now',{db:fixture(null,'0.00'),now});
 assert.match(r.answer,/Hourly rainfall: \*\*0 mm\*\*/);assert.doesNotMatch(r.answer,/not available/);
 const rain=r.evidence.find(e=>e.metric==='hourly_rainfall');assert.equal(rain.source,'KMA AWS 152');assert.equal(rain.observed_at,'2026-11-09T08:00:00+09:00');
});
test('absent or null AWS rainfall stays unavailable',async()=>{
 for(const value of [undefined,null]){const r=await answer('Ulsan rainfall now',{db:fixture(null,value),now});assert.match(r.answer,/Hourly rainfall: not available/);assert.doesNotMatch(r.answer,/\*\*0 mm/);}
});
test('a genuine zero in weather observations does not trigger AWS fallback',async()=>{
 const db=fixture('0.00',4);const r=await answer('Ulsan rainfall now',{db,now});assert.match(r.answer,/\*\*0 mm\*\*/);assert.equal(db.calls.some(c=>c.sql.includes('aws_rainfall_readings')),false);
});
