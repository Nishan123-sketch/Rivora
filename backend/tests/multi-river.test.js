const test=require('node:test');
const assert=require('node:assert/strict');
const {catalog,matchRiver}=require('../river-catalog');
const {wamisHour,parseCoord,mapReadings,normalizeStationInfo}=require('../wamis-client');

test('catalog has 100 uniquely keyed rivers and preserves five original Ulsan priorities',()=>{
 assert.equal(catalog.length,100);
 assert.equal(new Set(catalog.map(x=>x.river_id)).size,catalog.length);
 assert.ok(catalog.filter(x=>x.region_id==='ulsan').length>=5);
 assert.deepEqual(catalog.slice(0,5).map(x=>x.river_id),['taehwa','dongcheon','hoeya','oehwang','cheokgwa']);
});
test('river match requires official metadata river name and Ulsan location',()=>{
 assert.equal(matchRiver({riverName:'태화강',lat:35.55,lon:129.31})?.river_id,'taehwa');
 assert.equal(matchRiver({riverName:'동천',lat:35.60,lon:129.32})?.river_id,'dongcheon');
 assert.equal(matchRiver({riverName:'동천',lat:37.5,lon:127.1}),null);
 assert.equal(matchRiver({riverName:'북한강',lat:37.5,lon:127.1})?.river_id,'bukhan');
 assert.equal(matchRiver({riverName:'한강',lat:37.5,lon:127.1})?.river_id,'han');
 assert.equal(matchRiver({riverName:'한강',lat:null,lon:null})?.river_id,'han');
 assert.equal(matchRiver({riverName:'태화강',lat:null,lon:null}),null);
 assert.equal(matchRiver({riverName:'',lat:35.5,lon:129.3}),null);
});
test('official DMS coordinates converted correctly, invalid rejected',()=>{
 assert.equal(parseCoord('035-30-00','lat'),35.5);
 assert.equal(parseCoord('129-30-00','lon'),129.5);
 assert.equal(parseCoord('129-72-12','lon'),null);
 assert.equal(parseCoord('0','lat'),null);
});
test('metadata cannot be verified without real code/coords/river',()=>{
 assert.deepEqual(normalizeStationInfo({wlobscd:'2201670',obsnm:'태화교',rivnm:'태화강',lat:'035-34-00',lon:'129-20-00'}),
  {code:'2201670',riverName:'태화강',stationName:'태화교',lat:35+34/60,lon:129+20/60});
 assert.equal(normalizeStationInfo({wlobscd:'1234567',obsnm:'test',lat:'035-34-00',lon:'129-20-00'}),null);
});
test('WAMIS 24:00 is midnight next KST day; no invented missing levels',()=>{
 assert.equal(wamisHour('2026103124'),'2026-11-01 00:00:00');
 assert.equal(wamisHour('2026103100'),null);
 assert.equal(wamisHour('2026130124'),null);
 assert.deepEqual(mapReadings([{ymdh:'2026110101',wl:''},{ymdh:'2026110102',wl:'4.20'},{ymdh:'2026110103',wl:'-999'}]),
  [{observedAt:'2026-11-01 02:00:00',waterLevel:4.2}]);
});
