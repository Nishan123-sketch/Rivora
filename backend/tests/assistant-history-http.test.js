const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createRouter}=require('../assistant-history');
const id='12345678-1234-1234-1234-123456789abc';
test('saved chat HTTP ownership and deletion are enforced for every operation',async()=>{
 let deleted=false,changes=0;
 const db={async execute(sql,args){if(sql.startsWith('SELECT conversation_id FROM'))return [args[0]===id&&args[1]===1&&!deleted?[{conversation_id:id}]:[]];if(sql.startsWith('SELECT role,content'))return [[{role:'user',content:'owner message'}]];if(sql.startsWith('UPDATE')){assert.equal(args.at(-1),1);changes++;if(sql.includes('deleted_at=UTC'))deleted=true;return [{}];}throw Error('Unexpected SQL');}};
 const app=express();app.use(express.json());app.use(createRouter({db,auth:(req,res,next)=>{req.user={user_id:Number(req.headers['test-user'])};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/chat/conversations/${id}`;
 try{for(const method of ['GET','PATCH','DELETE','POST']){const url=method==='POST'?base+'/messages':base;const r=await fetch(url,{method,headers:{'test-user':'2','Content-Type':'application/json'},...(['PATCH','POST'].includes(method)?{body:JSON.stringify(method==='PATCH'?{title:'intrusion'}:{messages:[{role:'user',content:'intrusion'}]})}:{})});assert.equal(r.status,404);}
 assert.equal(changes,0);
 const read=await fetch(base,{headers:{'test-user':'1'}});assert.equal(read.status,200);assert.equal((await read.json()).messages[0].content,'owner message');
 const rename=await fetch(base,{method:'PATCH',headers:{'test-user':'1','Content-Type':'application/json'},body:JSON.stringify({title:'My river'})});assert.equal(rename.status,200);
 const remove=await fetch(base,{method:'DELETE',headers:{'test-user':'1'}});assert.equal(remove.status,200);
 const hidden=await fetch(base,{headers:{'test-user':'1'}});assert.equal(hidden.status,404);assert.equal(changes,2);
 }finally{await new Promise(r=>server.close(r));}
});
