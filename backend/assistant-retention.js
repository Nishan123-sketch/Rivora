// Administrative maintenance only. The language model has no route to invoke this.
require('dotenv').config();
async function purge(db=require('./db')){
 const connection=await db.getConnection();try{await connection.beginTransaction();
 const [messages]=await connection.query('DELETE m FROM assistant_messages m JOIN assistant_conversations c ON c.conversation_id=m.conversation_id WHERE c.deleted_at<UTC_TIMESTAMP()-INTERVAL 30 DAY OR c.updated_at<UTC_TIMESTAMP()-INTERVAL 90 DAY');
 const [conversations]=await connection.query('DELETE FROM assistant_conversations WHERE deleted_at<UTC_TIMESTAMP()-INTERVAL 30 DAY OR updated_at<UTC_TIMESTAMP()-INTERVAL 90 DAY');
 await connection.commit();return {messages:messages.affectedRows,conversations:conversations.affectedRows};
 }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}
if(require.main===module){const db=require('./db');purge(db).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.code||'RETENTION_FAILED');process.exitCode=1;}).finally(()=>db.end());}
module.exports={purge};
