const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseCsv,validateThreshold,validateRainfall,validateLocation}=require('../import-reference-data');
const {streamProvider,parseLine}=require('../chat-stream');
test('threshold rows must be ordered and sourced',()=>{
 const ok={station_id:'207',interest_level_m:'1',caution_level_m:'2',alert_level_m:'3',severe_level_m:'4',source_url:'https://www.hrfco.go.kr/'};
 assert.equal(validateThreshold(ok).errors.length,0);
 assert.ok(validateThreshold({...ok,alert_level_m:'1.5'}).errors.length);
 assert.ok(validateThreshold({...ok,source_url:'https://example.org/x'}).errors.length);
});
test('rainfall and location rows are validated; csv quotes parse',()=>{
 assert.ok(validateRainfall({station_id:'1',aws_station_code:'',reference_url:'https://www.kma.go.kr/'}).errors.length);
 assert.equal(validateLocation({river_id:'a',latitude:'35.5',longitude:'129.3',source_url:'https://www.mois.go.kr/'},new Set(['a'])).errors.length,0);
 assert.ok(validateLocation({river_id:'a',latitude:'10',longitude:'129.3',source_url:'https://www.mois.go.kr/'},new Set(['a'])).errors.length);
 assert.deepEqual(parseCsv('a,b\n"x,y",2\n'),[{a:'x,y',b:'2'}]);
});
test('stream parsers yield tokens for each provider',async()=>{
 assert.equal(parseLine('ollama','{"message":{"content":"hi"}}'),'hi');
 assert.equal(parseLine('openai','data: {"choices":[{"delta":{"content":"yo"}}]}'),'yo');
 assert.equal(parseLine('gemini','data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}'),'ok');
 const enc=new TextEncoder();
 const fetcher=async()=>({ok:true,body:(async function*(){yield enc.encode('{"message":{"content":"Hel"}}\n{"message":{"con');yield enc.encode('tent":"lo"}}\n');})()});
 const out=[];for await(const t of streamProvider('s',[{role:'user',content:'q'}],undefined,fetcher,{LLM_PROVIDER:'ollama'}))out.push(t);
 assert.deepEqual(out,['Hel','lo']);
});
