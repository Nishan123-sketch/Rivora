'use strict';
const crypto=require('crypto');
const router=require('express').Router();
const sessions=new Map(),exchanges=new Map();
function providerConfig(provider,env=process.env){
 const prefix=provider==='google'?'GOOGLE':provider==='university'?'UNIVERSITY_OIDC':null;if(!prefix)return null;
 const issuer=provider==='google'?'https://accounts.google.com':env.UNIVERSITY_OIDC_ISSUER;
 const clientId=env[prefix+'_CLIENT_ID'],clientSecret=env[prefix+'_CLIENT_SECRET'];
 return issuer&&clientId&&clientSecret?{issuer,clientId,clientSecret}:null;
}
async function accountForIdentity(provider,claims,db=require('./db')){
 if(typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255||claims.email_verified!==true||typeof claims.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)||claims.email.length>254)throw Error('The identity provider must supply a verified email address.');
 if(typeof claims.iss!=='string'||!claims.iss.startsWith('https://'))throw Error('Invalid identity issuer');
 provider=provider+':'+claims.iss;
 const c=await db.getConnection();
 try{await c.beginTransaction();const [[identity]]=await c.execute('SELECT u.user_id,u.email,u.email_verified_at FROM oauth_identities o JOIN users u ON u.user_id=o.user_id WHERE o.provider=? AND o.subject=? FOR UPDATE',[provider,claims.sub]);if(identity){const email=claims.email.toLowerCase().trim();if(email!==identity.email){const [[conflict]]=await c.execute('SELECT user_id FROM users WHERE email=? FOR UPDATE',[email]);if(conflict)throw Error('This email already has a password account. Sign in with that account.');await c.execute('UPDATE users SET email=?,email_verified_at=UTC_TIMESTAMP() WHERE user_id=?',[email,identity.user_id]);identity.email=email;identity.email_verified_at=true;}await c.commit();return identity;}
  const email=claims.email.toLowerCase().trim();const [[existing]]=await c.execute('SELECT user_id FROM users WHERE email=? FOR UPDATE',[email]);if(existing)throw Error('This email already has a password account. Sign in with that account.');
  const passwordHash=await require('bcrypt').hash(crypto.randomBytes(48).toString('hex'),12);const [result]=await c.execute('INSERT INTO users(email,password_hash,email_verified_at) VALUES(?,?,UTC_TIMESTAMP())',[email,passwordHash]);await c.execute('INSERT INTO oauth_identities(provider,subject,user_id) VALUES(?,?,?)',[provider,claims.sub,result.insertId]);await c.commit();return {user_id:result.insertId,email,email_verified_at:true};
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
router.get('/auth/providers',(req,res)=>res.json({google:!!providerConfig('google'),university:!!providerConfig('university'),app_base_url:process.env.APP_BASE_URL||'http://localhost:5173'}));
router.get('/auth/oidc/:provider/start',async(req,res)=>{
 const details=providerConfig(req.params.provider);if(!details)return res.status(503).send('This sign-in provider has not been configured.');
 try{const client=await import('openid-client');const config=await client.discovery(new URL(details.issuer),details.clientId,details.clientSecret);const verifier=client.randomPKCECodeVerifier(),nonce=client.randomNonce(),state=client.randomState(),id=crypto.randomBytes(32).toString('hex');
  for(const [key,s] of sessions)if(s.expires<Date.now())sessions.delete(key);if(sessions.size>=1000)return res.status(429).send('Please try again later.');
  const redirect=(process.env.API_PUBLIC_URL||'http://localhost:5000').replace(/\/$/,'')+`/api/auth/oidc/${req.params.provider}/callback`;
  sessions.set(id,{provider:req.params.provider,config,verifier,nonce,state,redirect,expires:Date.now()+600000});
  res.cookie('rivora_oidc',id,{httpOnly:true,sameSite:'lax',secure:redirect.startsWith('https:'),maxAge:600000,path:'/api/auth/oidc'});
  res.redirect(client.buildAuthorizationUrl(config,{redirect_uri:redirect,scope:'openid email profile',code_challenge:await client.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce}).href);
 }catch{res.status(503).send('Identity provider unavailable. Please retry or use email sign-in.');}
});
router.get('/auth/oidc/:provider/callback',async(req,res)=>{
 const id=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('rivora_oidc='))?.slice(12);const session=sessions.get(id);sessions.delete(id);res.clearCookie('rivora_oidc',{path:'/api/auth/oidc'});
 if(!session||session.expires<Date.now()||session.provider!==req.params.provider)return res.status(400).send('Sign-in expired. Please start again.');
 try{const client=await import('openid-client');const current=new URL(session.redirect);current.search=new URL(req.originalUrl,'http://localhost').search;const tokens=await client.authorizationCodeGrant(session.config,current,{pkceCodeVerifier:session.verifier,expectedState:session.state,expectedNonce:session.nonce,idTokenExpected:true});const user=await accountForIdentity(session.provider,tokens.claims());
  const code=crypto.randomBytes(32).toString('hex');for(const [key,e] of exchanges)if(e.expires<Date.now())exchanges.delete(key);exchanges.set(code,{user,expires:Date.now()+120000});const destination=new URL((process.env.APP_BASE_URL||'http://localhost:5173').replace(/\/$/,'')+'/auth/callback');destination.hash=new URLSearchParams({code}).toString();res.redirect(destination.href);
 }catch(e){res.status(400).send(e.message==='This email already has a password account. Sign in with that account.'?e.message:'Provider sign-in could not be verified. Retry or use email sign-in.');}
});
router.post('/auth/oidc/exchange',require('./account-sessions').trustedWrite,async(req,res)=>{
 const code=req.body?.code;if(typeof code!=='string'||!/^[a-f0-9]{64}$/.test(code))return res.status(400).json({message:'Invalid sign-in code'});const entry=exchanges.get(code);exchanges.delete(code);if(!entry||entry.expires<Date.now())return res.status(400).json({message:'Sign-in code expired. Start again.'});
 const secret=process.env.JWT_SECRET;if(!secret||secret.length<32)return res.status(503).json({message:'Authentication configuration unavailable'});
 try{const db=require('./db'),u=await require('./account-sessions').userById(entry.user.user_id,db);if(u?.account_status!=='ACTIVE')return res.status(401).json({message:'Sign-in unavailable.'});const user=await require('./account-sessions').issue(req,res,u,db);await db.execute('UPDATE users SET last_login_at=UTC_TIMESTAMP() WHERE user_id=?',[u.user_id]);await require('./account-sessions').audit(db,u.user_id,'OIDC_LOGIN','SUCCESS');res.json({success:true,user,onboarding_required:true});}catch{res.status(503).json({message:'Session creation unavailable. Please retry sign-in.'});}
});
module.exports={router,providerConfig,accountForIdentity};
