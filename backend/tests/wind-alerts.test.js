const {test}=require('node:test');const assert=require('node:assert/strict');
const {attachWindObservations}=require('../wind-alerts');
const now=Date.parse('2026-11-07T02:00:00+09:00');
test('wind warnings show only recent area-matched observations and preserve zero',()=>{
 const official={data:[{type:'W',area:'울릉도.독도'},{type:'W',area:'강원도(인제군산지)'},{type:'R',area:'울산'}]};
 const rows=[{station_id:1,station_name:'울릉도',wind_speed:10,observed_at:'2026-11-07 01:00:00'},{station_id:2,station_name:'인제',wind_speed:0,observed_at:'2026-11-07 02:00:00'},{station_id:3,station_name:'울산',wind_speed:99,observed_at:'2026-11-07 01:00:00'}];
 const result=attachWindObservations(official,rows,now);
 assert.equal(result.data[0].wind_observations[0].speed_kmh,36);
 assert.equal(result.data[1].wind_observations[0].speed_ms,0);
 assert.equal(result.data[2].wind_observations,undefined);
 assert.equal(official.data[0].wind_observations,undefined);
});
test('missing, negative, stale, future or unrelated speeds never become warning measurements',()=>{
 const base={station_id:1,station_name:'울릉도',wind_speed:10,observed_at:'2026-11-07 01:00:00'};
 for(const patch of [{wind_speed:null},{wind_speed:-1},{wind_speed:''},{observed_at:'2026-11-06 20:00:00'},{observed_at:'2026-11-07 03:00:00'},{station_name:'부산'}]){
  const result=attachWindObservations({data:[{type:'W',area:'울릉도.독도'}]},[{...base,...patch}],now);
  assert.deepEqual(result.data[0].wind_observations,[]);
 }
});
