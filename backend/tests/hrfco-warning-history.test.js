'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {classifyNotice,parseKoreanTimestamp,normalizeResponse}=require('../hrfco-warning-history');
test('official advisory issuance and cancellation are different actions',()=>{
  assert.deepEqual(classifyNotice('홍수주의보 발령'),{severity:'ADVISORY',action:'ISSUE'});
  assert.deepEqual(classifyNotice('홍수주의보 해제'),{severity:'ADVISORY',action:'CANCEL'});
  assert.deepEqual(classifyNotice('홍수경보 변경발령'),{severity:'WARNING',action:'ISSUE'});
});
test('12-digit Korean issue timestamps are validated',()=>{
  assert.equal(parseKoreanTimestamp('202507192100'),'2025-07-19 21:00:00');
  assert.equal(parseKoreanTimestamp('202502302100'),null);
});
test('uploaded official warning response matches Taehwa WAMIS 2201670',()=>{
  const input=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/hrfco-20250719-historical.json'),'utf8'));
  const events=normalizeResponse(input);
  const codes=new Set(events.map(e=>e.station_code));
  assert.ok(events.length>=100);
  assert.ok(codes.size>=65);
  const taehwa=events.filter(e=>e.station_code==='2201670');
  assert.ok(taehwa.some(e=>e.action==='ISSUE'));
  assert.ok(taehwa.some(e=>e.action==='CANCEL'));
  assert.ok(taehwa.every(e=>e.severity==='ADVISORY'));
});
test('code 990 without content is not interpreted as proof of no warnings',()=>{
  assert.throws(()=>normalizeResponse({code:'990',message:'검색된 자료가 없습니다.'}),/Expected HRFCO JSON/);
});

test('national API replay does not duplicate an already reconciled office issuance',async()=>{
 const {importResponse}=require('../hrfco-warning-history');let inserts=0;
 const db={query:async()=>[[]],execute:async(sql)=>{if(sql.startsWith('SELECT event_id'))return [[{event_id:'office-archive-id'}]];inserts++;return [{affectedRows:1}];}};
 await importResponse(db,{content:[{sttnm:'3201690',ancdt:'202509130500',kind:'홍수주의보 발령',no:'different bulletin wording'}]});assert.equal(inserts,0);
});
