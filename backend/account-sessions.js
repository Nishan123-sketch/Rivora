'use strict';
const crypto=require('crypto');
const COOKIE='rivora_session',GUEST='rivora_guest';
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
function cookie(req,name){const value=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);return /^[a-f0-9]{64}$/.test(value||'')?value:null;}
function cookieOptions(req,maxAge){return {httpOnly:true,secure:process.env.NODE_ENV==='production'||req.secure,sameSite:'lax',path:'/api',maxAge};}
function isTrustedOrigin(value){let origin;try{origin=new URL(value).origin;}catch{return false;}
 const allowed=new Set([new URL(process.env.APP_BASE_URL||'http://localhost:5173').origin,new URL(process.env.API_PUBLIC_URL||'http://localhost:'+(Number(process.env.PORT)||5000)).origin]);
 if(allowed.has(origin))return true;
 // Vite may select the next port when 5173 is occupied. In development only,
 // trust loopback origins within Vite's documented default port range.
 if(process.env.NODE_ENV!=='production'){try{const u=new URL(origin);return ['localhost','127.0.0.1'].includes(u.hostname)&&Number(u.port)>=5173&&Number(u.port)<=5199;}catch{return false;}}
 return false;
}
function trustedWrite(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method)||req.headers.authorization?.startsWith('Bearer '))return next();
 if(!isTrustedOrigin(req.headers.origin)||req.headers['x-rivora-request']!=='1')return res.status(403).json({success:false,message:'Request origin could not be verified.'});next();
}
const publicUser=u=>({user_id:Number(u.user_id),email:u.email,email_verified:!!u.email_verified_at,display_name:u.display_name||'',role:u.role||'USER',account_type:u.student_id?'University':u.provider?.startsWith('google:')?'Google':u.provider?.startsWith('university:')?'University':'Email',student_id:u.student_id||null,must_change_password:!!u.must_change_password,announcements_enabled:!!u.announcements_enabled,province:u.province||null,city:u.city||null});
async function userById(id,db){const [[u]]=await db.execute('SELECT u.*, (SELECT provider FROM oauth_identities WHERE user_id=u.user_id LIMIT 1) provider,DATE_SUB(u.created_at,INTERVAL TIMESTAMPDIFF(MINUTE,UTC_TIMESTAMP(),NOW()) MINUTE) created_at FROM users u WHERE u.user_id=? LIMIT 1',[id]);return u;}
async function sessionUser(req,db=require('./db')){const raw=cookie(req,COOKIE);if(!raw)return null;const [[s]]=await db.execute('SELECT user_id FROM account_sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP()',[digest(raw)]);if(!s)return null;const u=await userById(s.user_id,db);return u?.account_status==='ACTIVE'?publicUser(u):null;}
async function issue(req,res,user,db=require('./db')){if(user.account_status&&user.account_status!=='ACTIVE')throw Object.assign(Error('Sign-in unavailable.'),{status:401});const raw=crypto.randomBytes(32).toString('hex'),age=30*24*3600000;await db.execute('INSERT INTO account_sessions(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY))',[digest(raw),user.user_id]);res.cookie(COOKIE,raw,cookieOptions(req,age));res.clearCookie(GUEST,{path:'/api'});return publicUser(await userById(user.user_id,db));}
async function guest(req,db=require('./db')){const raw=cookie(req,GUEST);if(!raw)return null;const [[s]]=await db.execute("SELECT DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%sZ') expires_at FROM guest_sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP()",[digest(raw)]);return s?{role:'GUEST',expires_at:s.expires_at}:null;}
async function audit(db,userId,action,outcome,actorId=null){await db.execute('INSERT INTO account_audit(user_id,actor_id,action,outcome) VALUES(?,?,?,?)',[userId||null,actorId,action,outcome]);}
// Existing bearer clients remain supported by the existing auth middleware.
async function apiAccess(req,res,next){if(/^\/(?:auth(?:\/|$)|monitoring-locations$|health$|alerts\/unsubscribe)/.test(req.path))return next();try{
 const user=await sessionUser(req);if(user){if(user.must_change_password&&!['/profile','/profile/password'].includes(req.path))return res.status(403).json({message:'Change your initial password before continuing.'});req.user=user;return next();}
 if(req.headers.authorization?.startsWith('Bearer '))return require('./auth-middleware')(req,res,next);
 if(await guest(req)){if(!['GET','HEAD'].includes(req.method)&&!['/chat','/chat/stream'].includes(req.path))return res.status(403).json({message:'Guest preview is read-only.'});return next();}return res.status(401).json({success:false,code:'PREVIEW_EXPIRED',message:'Sign in or start a three-minute guest preview.'});
 }catch{return res.status(503).json({message:'Session service unavailable.'});}}
module.exports={COOKIE,GUEST,digest,cookie,cookieOptions,isTrustedOrigin,trustedWrite,publicUser,userById,sessionUser,issue,guest,audit,apiAccess};
