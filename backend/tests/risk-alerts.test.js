const {test}=require('node:test');const assert=require('node:assert/strict');const {projectAlerts}=require('../risk-alerts');
test('alerts exclude unknown/low rivers and include weather-only heavy rainfall areas',()=>{
 const rows=[{station_id:1,risk_level:null},{station_id:2,risk_level:'Low'},{station_id:3,risk_level:'High',station_name:'Gauge'},{station_id:4,data_source:'KMA',station_name:'Area',rainfall_comparison:{status:'WARNING_CRITERION_MET',rainfall_3h_mm:95}}];
 const alerts=projectAlerts(rows);assert.equal(alerts.length,2);assert.equal(alerts[1].area,'Area');assert.match(alerts[1].reason,/Heavy rainfall/);
});
