const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parsePublicWarnings}=require('../official-alerts');
const {pickStationIds,timeRequest}=require('../chat-context');
const {groundedAnswer,isDataQuestion}=require('../grounded-answer');

test('public warnings require a recognized table and explicit empty status',()=>{
 const row='<tr data-type="R" data-level="2"><td>Rain</td><td>Advisory</td><td>Seoul</td><td>2026.11.07 01:00</td><td>2026.11.07 02:00</td></tr>';
 const alerts=parsePublicWarnings('<table id="current-warnings">'+row+'</table>');
 assert.equal(alerts.length,1);assert.equal(alerts[0].type,'R');assert.equal(alerts[0].area,'Seoul');
 assert.throws(()=>parsePublicWarnings('<html>Access denied</html>'));
 assert.throws(()=>parsePublicWarnings('<table id="current-warnings"></table>'));
 assert.deepEqual(parsePublicWarnings('<table id="current-warnings"><tr><td>발효된 특보가 없습니다</td></tr></table>'),[]);
});
test('a named bridge takes precedence over its river and weather nearby',()=>{
 const stations=[{station_id:207,station_name:'Taehwa River - Ulsan (Taehwa Bridge)',external_station_id:'2201670',data_source:'RIVER_GAUGE'},{station_id:208,station_name:'Gusu Bridge',data_source:'RIVER_GAUGE'},{station_id:31,station_name:'울산',data_source:'KMA'}];
 const links=[{river_id:'taehwa',station_id:207},{river_id:'taehwa',station_id:208}];
 assert.deepEqual(pickStationIds('Flood risk at Taehwa Bridge',null,[],stations,links),[207]);
 assert.deepEqual(pickStationIds('Rainfall at Taehwa Bridge',null,[],stations,links),[207]);
 assert.equal(timeRequest('tomorrow',new Date('2026-11-06T16:00:00Z')).date,'2026-11-08');
 assert.equal(isDataQuestion('What about tomorrow there?',[{role:'user',content:'Weather in Busan'}]),true);
});
test('grounded answers preserve zero and do not replace absent historical data',()=>{
 const station={station_name:'Example Bridge',latest_water:[{water_level:0,observed_at:'2026-11-07 00:00:00'}],unified_risk:{level:'Low'}};
 assert.match(groundedAnswer('water level',{stations:[station]}),/0\.00 m/);
 const answer=groundedAnswer('history yesterday',{stations:[station],requested_time:{date:'2026-11-06',explicit:true}});
 assert.match(answer,/No observations are stored/);assert.doesNotMatch(answer,/0\.00 m/);
});
