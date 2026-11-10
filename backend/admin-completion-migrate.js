'use strict';
async function migrate(db=require('./db')){
 const [users]=await db.query('SHOW COLUMNS FROM users');if(!users.some(c=>c.Field==='city'))await db.query('ALTER TABLE users ADD COLUMN city VARCHAR(100) NULL');
 if(!users.find(c=>c.Field==='account_status')?.Type.includes('PENDING'))await db.query("ALTER TABLE users MODIFY account_status ENUM('ACTIVE','DISABLED','PENDING') NOT NULL DEFAULT 'ACTIVE'");
 await db.query("CREATE TABLE IF NOT EXISTS account_invitations (invitation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,status ENUM('PENDING','SENT','FAILED','USED','SUPERSEDED') NOT NULL DEFAULT 'PENDING',created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at DATETIME NOT NULL,used_at DATETIME NULL,INDEX(user_id,created_at),FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE) ENGINE=InnoDB");
 const [actions]=await db.query('SHOW COLUMNS FROM account_actions');if(!actions.some(c=>c.Field==='invitation_id'))await db.query('ALTER TABLE account_actions ADD COLUMN invitation_id BIGINT UNSIGNED NULL');
}
if(require.main===module){require('dotenv').config();const db=require('./db');migrate(db).then(()=>console.log('Additive admin schema ready; existing users and passwords retained.')).catch(e=>{console.error(e.code||e.name);process.exitCode=1;}).finally(()=>db.end());}
module.exports={migrate};
