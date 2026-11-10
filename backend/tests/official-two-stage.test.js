const {test}=require('node:test'),assert=require('node:assert/strict');
const {evaluate}=require('../risk-engine');
const now=Date.now(),station={station_id:207,external_station_id:'2201670',data_source:'RIVER_GAUGE',station_name:'Taehwa Bridge'};
const threshold={verification_status:'VERIFIED',verified_at:'2026-11-05',source_url:'https://www.nakdongriver.go.kr/sumun/brief.do',advisory_level_m:8.2,warning_level_m:9.2,reference_source:'SCHEME:TWO_STAGE;WAMIS:2201670;DATUM:CONFIRMED;'};
const assess=(value,t=threshold,s=station,age=0)=>evaluate({station:s,threshold:t,latest:{water_level:value,observed_at:new Date(now-age).toISOString()},now});
test('published thresholds retain their arithmetic but legacy datum tags cannot authorize classification',()=>{const {compareTwoStage}=require('../official-two-stage');for(const [value,level] of [[5.07,'Low'],[8.2,'Moderate'],[9.2,'High']]){assert.equal(compareTwoStage(value,{advisory:8.2,warning:9.2}).level,level);assert.equal(assess(value).level,null);}});

test('unverified identity, datum and unordered thresholds cannot enable two-stage mode',()=>{for(const t of [{...threshold,verification_status:'UNVERIFIED'},{...threshold,reference_source:'SCHEME:TWO_STAGE;WAMIS:9999999;DATUM:CONFIRMED;'},{...threshold,reference_source:'SCHEME:TWO_STAGE;WAMIS:2201670;'},{...threshold,warning_level_m:8}])assert.notEqual(assess(5,t).tier,'A');});
test('stale readings and dams remain excluded with official two-stage evidence',()=>{assert.equal(assess(10,threshold,station,4*3600000).level,null);assert.equal(assess(10,threshold,{...station,station_name:'Reservoir dam'}).level,null);});
