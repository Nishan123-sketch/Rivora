'use strict';
const crypto=require('crypto'),bcrypt=require('bcrypt');
const {digest}=require('./account-sessions');
const validEmail=s=>typeof s==='string'&&s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const validPassword=s=>typeof s==='string'&&s.length>=12&&Buffer.byteLength(s,'utf8')<=72;
async function createAction(userId,purpose,email,db,sendEmail=require('./email-service').sendEmail){
 const token=crypto.randomBytes(32).toString('hex');
 let invitationId=null;
 if(purpose==='ACTIVATE'){await db.execute("UPDATE account_invitations SET status='SUPERSEDED' WHERE user_id=? AND status IN ('PENDING','SENT')",[userId]);const [invitation]=await db.execute('INSERT INTO account_invitations(user_id,expires_at) VALUES(?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))',[userId]);invitationId=invitation.insertId;}
 await db.execute('DELETE FROM account_actions WHERE user_id=? AND purpose=?',[userId,purpose]);
 await db.execute('INSERT INTO account_actions(token_hash,user_id,purpose,pending_email,expires_at,invitation_id) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE),?)',[digest(token),userId,purpose,email,invitationId]);
 const base=(process.env.APP_BASE_URL||'http://localhost:5173').replace(/\/$/,'');
 try{await sendEmail(email,'Rivora account verification',`Complete your ${purpose==='ACTIVATE'?'account activation':purpose==='RECOVER'?'password recovery':'email change'} using this one-time link within 30 minutes:\n${base}/account/action#token=${token}&purpose=${purpose}\nIf you did not request this, ignore this message. Never share this link.`);if(invitationId)await db.execute("UPDATE account_invitations SET status='SENT' WHERE invitation_id=?",[invitationId]);}catch(e){if(invitationId)await db.execute("UPDATE account_invitations SET status='FAILED' WHERE invitation_id=?",[invitationId]);throw e;}
}
async function consumeAction({token,purpose,password},db){
 if(!/^[a-f0-9]{64}$/.test(token||'')||!['ACTIVATE','RECOVER','EMAIL_CHANGE'].includes(purpose)||purpose!=='EMAIL_CHANGE'&&!validPassword(password))throw Object.assign(Error('Invalid or expired verification, or password does not meet requirements.'),{status:400});
 const hash=purpose==='EMAIL_CHANGE'?null:await bcrypt.hash(password,12),c=await db.getConnection();
 try{await c.beginTransaction();const [[a]]=await c.execute('SELECT * FROM account_actions WHERE token_hash=? AND purpose=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE',[digest(token),purpose]);if(!a)throw Object.assign(Error('Invalid or expired verification.'),{status:400});
 if(purpose==='EMAIL_CHANGE'){const [updated]=await c.execute('UPDATE users SET email=?,email_verified_at=UTC_TIMESTAMP(),sessions_revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND account_status=?',[a.pending_email,a.user_id,'ACTIVE']);if(updated.affectedRows!==1)throw Object.assign(Error('The account is not eligible for this email change.'),{status:400});}
 else {const [updated]=await c.execute("UPDATE users SET password_hash=?,email_verified_at=IF(?='ACTIVATE',UTC_TIMESTAMP(),email_verified_at),account_status=IF(?='ACTIVATE','ACTIVE',account_status),must_change_password=0,sessions_revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND (account_status='ACTIVE' OR (?='ACTIVATE' AND account_status='PENDING')) AND (?<>'ACTIVATE' OR email=?)",[hash,purpose,purpose,a.user_id,purpose,purpose,a.pending_email||null]);if(updated.affectedRows!==1)throw Object.assign(Error('Account activation or recovery is unavailable.'),{status:400});}
 if(purpose==='ACTIVATE'){if(a.invitation_id)await c.execute("UPDATE account_invitations SET status='USED',used_at=UTC_TIMESTAMP() WHERE invitation_id=?",[a.invitation_id]);await require('./account-sessions').audit(c,a.user_id,'ACCOUNT_ACTIVATED','SUCCESS');}
 await c.execute('DELETE FROM account_sessions WHERE user_id=?',[a.user_id]);await c.execute('DELETE FROM account_actions WHERE user_id=?',[a.user_id]);await c.commit();return a.user_id;
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
async function provisionStudent({student_id,email},db,sendEmail){
 if(!/^2530(?:0[1-9]|[1-4][0-9]|50)$/.test(student_id||'')||!validEmail(email))throw Object.assign(Error('Use an eligible ID (253001–253050) and a valid email.'),{status:400});
 // The administrator supplies ownership mapping; email ownership is established only by activation.
 const hash=await bcrypt.hash(crypto.randomBytes(48).toString('hex'),12);
 const [r]=await db.execute("INSERT INTO users(email,password_hash,student_id,must_change_password,account_status) VALUES(?,?,?,1,'PENDING')",[email.trim().toLowerCase(),hash,student_id]);
 try{await createAction(r.insertId,'ACTIVATE',email.trim().toLowerCase(),db,sendEmail);return {user_id:r.insertId,activation_sent:true};}catch{return {user_id:r.insertId,activation_sent:false};}
}
module.exports={validEmail,validPassword,createAction,consumeAction,provisionStudent};
