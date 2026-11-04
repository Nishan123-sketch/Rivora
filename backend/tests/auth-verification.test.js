const test=require('node:test');
const assert=require('node:assert/strict');
const pool=require('../db');
const app=require('../server');
const {hashOtp}=require('../email-verification');

const previous = pool.getConnection;
process.env.OTP_SECRET='synthetic-otp-secret-for-mock-tests-only-123456';
const email='test-otp@example.test';
const userId=99,goodOtp='123456';

async function startServer(){
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 return {server,base:`http://127.0.0.1:${server.address().port}`};
}
async function post(base,otp){
 const response=await fetch(`${base}/api/auth/verify-otp`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,otp})});
 return {status:response.status,body:await response.json()};
}

test('valid OTP is verified with a fake transactional database, not real email', async()=>{
 let committed=false,verified=false,deleted=false;
 pool.getConnection=async()=>({
   async beginTransaction(){}, async commit(){committed=true}, async rollback(){},release(){},
   async execute(sql,args){
     if(sql.includes('FROM users'))return [[{user_id:userId,email_verified_at:null}]];
     if(sql.includes('SELECT') && sql.includes('FROM email_verification_tokens'))return [[{token_id:55,token_hash:hashOtp(userId,goodOtp),attempts:0,is_valid:1}]];
     if(sql.includes('UPDATE users')){verified=true;assert.deepEqual(args,[userId]);return [{affectedRows:1}]}
     if(sql.includes('DELETE FROM email_verification_tokens')){deleted=true;return [{affectedRows:1}]}
     throw Error('Unrecognized fake SQL');
   }
 });
 const {server,base}=await startServer();
 try { const result=await post(base,goodOtp);assert.equal(result.status,200);assert.equal(result.body.success,true);assert.ok(verified&&committed&&deleted); }
 finally {pool.getConnection=previous;await new Promise(resolve=>server.close(resolve));}
});

test('incorrect OTP increments attempt counter without verifying account',async()=>{
 let committed=false,incremented=false,verified=false;
 pool.getConnection=async()=>({
   async beginTransaction(){},async commit(){committed=true},async rollback(){},release(){},
   async execute(sql){
     if(sql.includes('FROM users'))return [[{user_id:userId,email_verified_at:null}]];
     if(sql.includes('SELECT') && sql.includes('FROM email_verification_tokens'))return [[{token_id:55,token_hash:hashOtp(userId,goodOtp),attempts:1,is_valid:1}]];
     if(sql.includes('attempts = attempts + 1')){incremented=true;return [{affectedRows:1}]}
     if(sql.includes('UPDATE users')){verified=true;return [{affectedRows:1}]}
     throw Error('Unrecognized fake SQL');
   }
 });
 const {server,base}=await startServer();
 try {const result=await post(base,'111111');assert.equal(result.status,400);assert.equal(result.body.success,false);assert.ok(incremented&&committed);assert.equal(verified,false);}
 finally {pool.getConnection=previous;await new Promise(resolve=>server.close(resolve));}
});
