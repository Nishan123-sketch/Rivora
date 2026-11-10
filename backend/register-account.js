async function createAccount({email,passwordHash,stationId,consent},db=require('./db')){
 if(!Number.isSafeInteger(stationId)||stationId<=0||typeof consent!=='boolean')throw Object.assign(Error('Choose a nearest river station and an email consent preference.'),{status:400});
 const c=await db.getConnection();
 try{await c.beginTransaction();const [[s]]=await c.execute("SELECT station_id FROM stations s WHERE station_id=? AND data_source='RIVER_GAUGE' AND EXISTS(SELECT 1 FROM river_gauge_links l WHERE l.station_id=s.station_id AND l.verification_status='VERIFIED')",[stationId]);if(!s)throw Object.assign(Error('Verified river station not found.'),{status:400});const [result]=await c.execute('INSERT INTO users(email,password_hash) VALUES(?,?)',[email,passwordHash]);await c.execute('INSERT INTO user_alert_preferences(user_id,station_id,weather_enabled,flood_enabled,consent_at) VALUES(?,?,0,?,UTC_TIMESTAMP())',[result.insertId,stationId,consent]);await c.commit();return result;}catch(e){await c.rollback();throw e;}finally{c.release();}
}
module.exports={createAccount};
