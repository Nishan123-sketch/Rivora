const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const backend=path.join(__dirname,'..');
test('automatic warnings are opt-in',()=>{
 const env=fs.readFileSync(path.join(backend,'.env.example'),'utf8');
 assert.match(env,/ENABLE_AUTOMATIC_ALERTS=false/);
 assert.match(env,/ENABLE_ALERT_EMAILS=false/);
});
test('alerts require verified assessment',()=>{
 const code=fs.readFileSync(path.join(backend,'automatic-alerts.js'),'utf8');
 assert.match(code,/risk_status\s*!==\s*'ASSESSED'/);
 assert.match(code,/\[Project advisory\]/);
});
test('KMA forecast importer preserves additional data categories',()=>{
 const code=fs.readFileSync(path.join(backend,'import-kma-forecast.js'),'utf8');
 for(const category of ['TMP','PCP','POP','REH','WSD'])assert.ok(code.includes(`'${category}'`));
});
