'use strict';
// Only stdin accepts the owner's current password. Never put credentials on argv.
require('dotenv').config();
async function provision({email,password},db=require('../db')){
 if(!process.env.ADMIN_EMAIL||email!==process.env.ADMIN_EMAIL||typeof password!=='string'||password.length<12)throw Error('Use the designated owner email and a strong current account password.');
 const [[u]]=await db.execute('SELECT * FROM users WHERE email=?',[email]);
 if(!u||!u.email_verified_at||u.account_status!=='ACTIVE'||u.must_change_password||!await require('bcrypt').compare(password,u.password_hash))throw Error('Ownership is not verified. Create/verify the existing account and supply its current password first.');
 const c=await db.getConnection();try{await c.beginTransaction();const [[locked]]=await c.execute('SELECT email_verified_at,password_hash,account_status FROM users WHERE user_id=? FOR UPDATE',[u.user_id]);if(!locked?.email_verified_at||locked.account_status!=='ACTIVE'||locked.password_hash!==u.password_hash)throw Error('Account changed; repeat verification.');await c.execute("UPDATE users SET role='ADMIN',sessions_revoked_at=UTC_TIMESTAMP() WHERE user_id=?",[u.user_id]);await c.execute('DELETE FROM account_sessions WHERE user_id=?',[u.user_id]);await c.execute('DELETE FROM account_actions WHERE user_id=?',[u.user_id]);await require('../account-sessions').audit(c,u.user_id,'OWNER_ADMIN_PROVISION','SUCCESS',u.user_id);await c.commit();return {success:true,user_id:u.user_id};}catch(e){await c.rollback();throw e;}finally{c.release();}
}
if(require.main===module){let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{input+=s;if(input.length>2000)process.exit(1);});process.stdin.on('end',async()=>{const db=require('../db');try{const result=await provision(JSON.parse(input),db);console.log(JSON.stringify(result));}catch(e){console.error(e.message);process.exitCode=1;}finally{input='';await db.end();}});}
module.exports={provision};
