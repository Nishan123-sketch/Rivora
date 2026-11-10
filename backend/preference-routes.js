const express=require('express');
function createRouter({db=require('./db'),auth=require('./auth-middleware'),catalog=require('./monitoring-locations').catalog,env=process.env}={}){
 const router=express.Router();
 router.get('/monitoring-locations',async(req,res)=>{try{res.json({success:true,data:await catalog(db)});}catch{res.status(503).json({success:false,message:'Monitoring location catalog is unavailable.'});}});
 router.use('/alert-preferences',auth);
 router.get('/alert-preferences',async(req,res)=>{try{
  const [rows]=await db.execute(`SELECT p.station_id,p.weather_enabled,p.flood_enabled FROM user_alert_preferences p JOIN stations s ON s.station_id=p.station_id WHERE p.user_id=? AND s.data_source='RIVER_GAUGE' AND EXISTS(SELECT 1 FROM river_gauge_links l WHERE l.station_id=s.station_id AND l.verification_status='VERIFIED') ORDER BY p.consent_at DESC,p.preference_id DESC`,[req.user.user_id]);
  res.json({success:true,data:rows,capabilities:{weather_alert_generation_enabled:false,experimental_email_notifications_enabled:false,automatic_generation_enabled:env.ENABLE_AUTOMATIC_ALERTS==='true',email_delivery_enabled:env.ENABLE_AUTOMATIC_ALERTS==='true'&&env.ENABLE_ALERT_EMAILS==='true'&&env.ALERT_DRY_RUN==='false'&&Boolean(env.SMTP_HOST&&env.SMTP_USER&&env.SMTP_APP_PASSWORD)}});
 }catch{res.status(503).json({success:false,message:'Could not load preferences'});}});
 router.put('/alert-preferences',async(req,res)=>{
  const {station_id,weather_enabled,flood_enabled,replace_existing=false}=req.body||{};
  if(!Number.isSafeInteger(station_id)||station_id<=0||typeof weather_enabled!=='boolean'||typeof flood_enabled!=='boolean'||typeof replace_existing!=='boolean'||Object.keys(req.body||{}).some(k=>!['station_id','weather_enabled','flood_enabled','replace_existing'].includes(k)))return res.status(400).json({success:false,message:'Select a valid station and notification options'});
  if(!req.user.email_verified)return res.status(403).json({success:false,message:'Verify your email before saving alert preferences'});
  let c;try{
   const [stations]=await db.execute("SELECT station_id FROM stations s WHERE station_id=? AND data_source='RIVER_GAUGE' AND EXISTS(SELECT 1 FROM river_gauge_links l WHERE l.station_id=s.station_id AND l.verification_status='VERIFIED')",[station_id]);
   if(!stations.length||!(await catalog(db)).some(s=>Number(s.station_id)===station_id))return res.status(400).json({success:false,message:'Choose a verified monitored river station.'});
   c=await db.getConnection();await c.beginTransaction();await c.execute('SELECT user_id FROM users WHERE user_id=? FOR UPDATE',[req.user.user_id]);
   if(replace_existing)await c.execute('DELETE FROM user_alert_preferences WHERE user_id=?',[req.user.user_id]);
   await c.execute(`INSERT INTO user_alert_preferences(user_id,station_id,weather_enabled,flood_enabled,consent_at) VALUES(?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE weather_enabled=VALUES(weather_enabled),flood_enabled=VALUES(flood_enabled),consent_at=UTC_TIMESTAMP()`,[req.user.user_id,station_id,weather_enabled,flood_enabled]);
   await c.commit();res.json({success:true,message:'Monitoring location saved. Email notifications cover relevant verified official flood warnings only, when delivery and source coverage are available.'});
  }catch{if(c)await c.rollback();res.status(503).json({success:false,message:'Could not save preferences'});}finally{c?.release();}
 });return router;
}
module.exports=createRouter();module.exports.createRouter=createRouter;
