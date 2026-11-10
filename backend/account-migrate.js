'use strict';
// Additive and repeatable: no existing account, observation or preference is replaced.
async function migrate(db=require('./db')){
 const additions={display_name:"VARCHAR(100) NOT NULL DEFAULT ''",role:"ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER'",account_status:"ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE'",student_id:'VARCHAR(6) NULL',must_change_password:'BOOLEAN NOT NULL DEFAULT FALSE',announcements_enabled:'BOOLEAN NOT NULL DEFAULT FALSE',province:'VARCHAR(80) NULL',last_login_at:'DATETIME NULL',sessions_revoked_at:'DATETIME NULL'};
 const [columns]=await db.query('SHOW COLUMNS FROM users');
 for(const [key,type]of Object.entries(additions))if(!columns.some(c=>c.Field===key))await db.query(`ALTER TABLE users ADD COLUMN ${key} ${type}`);
 const [indexes]=await db.query('SHOW INDEX FROM users');if(!indexes.some(i=>i.Key_name==='uq_student_id'))await db.query('ALTER TABLE users ADD UNIQUE KEY uq_student_id(student_id)');
 const sql=[
 `CREATE TABLE IF NOT EXISTS account_sessions (token_hash CHAR(64) PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at DATETIME NOT NULL,INDEX(user_id),FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS guest_sessions (token_hash CHAR(64) PRIMARY KEY,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at DATETIME NOT NULL) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS account_actions (token_hash CHAR(64) PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,purpose ENUM('ACTIVATE','RECOVER','EMAIL_CHANGE') NOT NULL,pending_email VARCHAR(254) NULL,expires_at DATETIME NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX(user_id),FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS account_audit (audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NULL,actor_id BIGINT UNSIGNED NULL,action VARCHAR(50) NOT NULL,outcome VARCHAR(30) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX(created_at)) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS admin_messages (message_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,actor_id BIGINT UNSIGNED NOT NULL,subject VARCHAR(160) NOT NULL,body TEXT NOT NULL,idempotency_key CHAR(36) NOT NULL UNIQUE,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`,
 `CREATE TABLE IF NOT EXISTS admin_message_deliveries (message_id BIGINT UNSIGNED NOT NULL,user_id BIGINT UNSIGNED NOT NULL,status ENUM('queued','sending','sent','failed','unknown','cancelled') NOT NULL DEFAULT 'queued',attempt_count INT NOT NULL DEFAULT 0,attempted_at DATETIME NULL,sent_at DATETIME NULL,PRIMARY KEY(message_id,user_id),FOREIGN KEY(message_id) REFERENCES admin_messages(message_id),FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE) ENGINE=InnoDB`
 ];for(const statement of sql)await db.query(statement);
 const [n]=await db.query('SHOW COLUMNS FROM email_notifications');if(!n.some(c=>c.Field==='attempt_count'))await db.query('ALTER TABLE email_notifications ADD COLUMN attempt_count INT NOT NULL DEFAULT 0');if(!n.find(c=>c.Field==='status').Type.includes('sending'))await db.query("ALTER TABLE email_notifications MODIFY status ENUM('queued','sending','sent','failed') NOT NULL DEFAULT 'queued'");
 await require('./admin-completion-migrate').migrate(db);
}
if(require.main===module){require('dotenv').config();const db=require('./db');migrate(db).then(()=>console.log('Account schema updated additively.')).catch(e=>{console.error(e.code||e.name);process.exitCode=1;}).finally(()=>db.end());}
module.exports={migrate};
