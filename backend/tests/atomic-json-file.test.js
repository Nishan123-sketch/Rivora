const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {writeJson}=require('../atomic-json-file');
test('snapshot publication retries a sharing violation and retains original until replacement',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rivora-atomic-')),file=path.join(dir,'snapshot.json');fs.writeFileSync(file,'{"old":true}');let calls=0;
 try{writeJson(file,{new:true},{wait:()=>{},rename:(source,target)=>{calls++;if(calls<3){assert.equal(JSON.parse(fs.readFileSync(file)).old,true);throw Object.assign(Error('locked'),{code:'EPERM'});}fs.renameSync(source,target);}});assert.equal(calls,3);assert.deepEqual(JSON.parse(fs.readFileSync(file)),{new:true});assert.deepEqual(fs.readdirSync(dir),['snapshot.json']);}
 finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}
});
test('persistent snapshot locks never remove the current published report',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rivora-atomic-')),file=path.join(dir,'snapshot.json');fs.writeFileSync(file,'{"old":true}');
 try{assert.throws(()=>writeJson(file,{new:true},{wait:()=>{},rename:()=>{throw Object.assign(Error('locked'),{code:'EACCES'});}}));assert.equal(JSON.parse(fs.readFileSync(file)).old,true);assert.deepEqual(fs.readdirSync(dir),['snapshot.json']);}
 finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}
});
