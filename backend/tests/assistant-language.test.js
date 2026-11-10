const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeQuestion}=require('../assistant-language'),{intent,answer}=require('../assistant-core');
for(const [input,expected]of [['weatehr','weather'],['wheather','weather'],['weathr','weather'],['forcast','forecast'],['tomorow','tomorrow'],['tommorow','tomorrow'],['yestersays','yesterday'],['yestarday','yesterday'],["yesterday's",'yesterday'],['temprature','temperature']])test('domain typo: '+input,()=>assert.equal(normalizeQuestion(input),expected));
test('names, IDs, numeric readings and ordinary words are preserved',()=>assert.equal(normalizeQuestion('Whether Nishan Ulsan 2201670 2026-11-06 4.2 m'),'Whether Nishan Ulsan 2201670 2026-11-06 4.2 m'));
test('the exact screenshot question is a data request',()=>assert.equal(intent('now tell me yestersays ulsan weatehr'),'data'));
test('misspelled yesterday weather uses historical database evidence',async()=>{
 const calls=[];const db={execute:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM stations'))return [[{station_id:31,station_name:'Ulsan',external_station_id:'152',data_source:'KMA'}]];if(sql.includes('FROM water_readings'))return [[]];if(sql.includes('FROM weather_readings'))return [[{observed_at:'2026-11-06 12:00:00',temperature:14,wind_speed:3}]];throw Error('Unexpected query');}};
 const r=await answer('now tell me yestersays ulsan weatehr',{db,now:Date.parse('2026-11-07T16:00:00+09:00')});
 assert.equal(r.mode,'DATABASE_GROUNDED');assert.deepEqual(r.station_ids,[31]);assert.ok(r.tools.includes('get_history'));assert.match(r.answer,/2026-11-06 KST/);assert.match(r.answer,/14 °C/);assert.doesNotMatch(r.answer,/real.time|latest forecast/i);assert.equal(calls[2].args[1],'2026-11-06 00:00:00');
});
