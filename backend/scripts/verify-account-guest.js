'use strict';
// Own temporary guest fixture only. No real user or email is created or modified.
require('dotenv').config();
const fs=require('fs'),path=require('path'),db=require('../db'),{digest}=require('../account-sessions');
const base=process.env.ACCOUNT_CHECK_URL||'http://127.0.0.1:5001';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local verification only');
(async()=>{const results=[],headers={'Content-Type':'application/json',Origin:process.env.APP_BASE_URL||'http://localhost:5173','X-Rivora-Request':'1'};let hash;
 const check=(name,passed,detail)=>results.push({name,passed,detail});
 try{const r=await fetch(base+'/api/auth/guest',{method:'POST',headers,body:'{}'}),d=await r.json();check('Guest created',r.ok&&d.guest?.role==='GUEST',r.status);if(!r.ok)throw Error('Guest fixture unavailable');
 const raw=r.headers.get('set-cookie')?.match(/rivora_guest=([a-f0-9]{64})/)?.[1];if(!raw)throw Error('Guest cookie missing');hash=digest(raw);headers.Cookie='rivora_guest='+raw;
 const remaining=Date.parse(d.guest.expires_at)-Date.now();check('Three-minute lifetime',remaining>170000&&remaining<=180000,remaining);
 let p=await fetch(base+'/api/auth/session',{headers});let j=await p.json();check('Refresh retains expiration',j.guest?.expires_at===d.guest.expires_at,j.guest?.expires_at);
 for(const [endpoint,allowed]of [['/api/risk/unified/207',true],['/api/profile',false],['/api/admin/overview',false],['/api/alert-preferences',false]]){p=await fetch(base+endpoint,{headers});check(endpoint,allowed?p.ok:[401,403].includes(p.status),p.status);}
 // Advance only this fixture's database expiry; the server must reject it regardless of browser timer.
 await db.execute('UPDATE guest_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE token_hash=?',[hash]);
 p=await fetch(base+'/api/risk/unified/207',{headers});check('Backend rejects expired guest',p.status===401,p.status);
 p=await fetch(base+'/api/auth/guest',{method:'POST',headers,body:'{}'});check('Same cookie cannot renew expired preview',p.status===401,p.status);
 }finally{if(hash)await db.execute('DELETE FROM guest_sessions WHERE token_hash=?',[hash]);const report={checked_at:new Date().toISOString(),results};fs.writeFileSync(path.join(__dirname,'../reports/account-guest-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length}));if(results.some(r=>!r.passed))process.exitCode=1;}
})().catch(e=>{console.error(e.name);process.exitCode=1;}).finally(()=>db.end());
