async function processUnifiedEmailQueue({db,env=process.env,getOfficialWarning=require('./unified-alerts').officialWarning,now=Date.now,sendEmail=require('./email-service').sendEmail,logger=console}){
 if(env.ENABLE_AUTOMATIC_ALERTS!=='true'||env.ENABLE_ALERT_EMAILS!=='true')return {status:'DISABLED',sent:0};
 const dry=env.ALERT_DRY_RUN!=='false';
 if(!dry&&!(env.SMTP_HOST&&env.SMTP_USER&&env.SMTP_APP_PASSWORD))return {status:'SMTP_NOT_CONFIGURED',sent:0};
 const [queue]=await db.execute(`SELECT DISTINCT n.notification_id,n.user_id,u.email,a.station_id,a.severity,a.message_text FROM email_notifications n JOIN users u ON u.user_id=n.user_id JOIN alerts a ON a.alert_id=n.alert_id JOIN user_alert_preferences p ON p.user_id=u.user_id AND p.station_id=a.station_id WHERE n.status IN ('queued','failed') AND n.attempt_count<3 AND (n.attempted_at IS NULL OR n.attempted_at<UTC_TIMESTAMP()-INTERVAL 15 MINUTE) AND u.email_verified_at IS NOT NULL AND u.account_status='ACTIVE' AND p.flood_enabled=1 AND p.consent_at IS NOT NULL AND a.status='active' AND a.message_text LIKE '[Official warning:%' AND (a.expires_at IS NULL OR a.expires_at>UTC_TIMESTAMP()) ORDER BY n.notification_id LIMIT 20`);
 let sent=0,eligible=0;
 for(const q of queue){const warning=await getOfficialWarning(db,q.station_id,now());const eventId=q.message_text.match(/^\[Official warning:([a-f0-9]{64})\]/i)?.[1];if(!warning||warning.event.event_id!==eventId)continue;eligible++;
  if(dry){logger.info('[Email dry-run] eligible notification:',q.notification_id);continue;}
  const [claim]=await db.execute("UPDATE email_notifications SET status='sending',attempt_count=attempt_count+1,attempted_at=UTC_TIMESTAMP() WHERE notification_id=? AND status IN ('queued','failed') AND attempt_count<3 AND EXISTS(SELECT 1 FROM user_alert_preferences p JOIN users u ON u.user_id=p.user_id JOIN alerts a ON a.alert_id=email_notifications.alert_id WHERE p.user_id=email_notifications.user_id AND p.station_id=a.station_id AND p.flood_enabled=1 AND p.consent_at IS NOT NULL AND u.email_verified_at IS NOT NULL AND u.account_status='ACTIVE') AND (attempted_at IS NULL OR attempted_at<UTC_TIMESTAMP()-INTERVAL 15 MINUTE)",[q.notification_id]);if(claim.affectedRows!==1)continue;
  let accepted=false;
  try{const base=(env.APP_BASE_URL||'http://localhost:5173').replace(/\/$/,'');const api=(env.API_PUBLIC_URL||'http://localhost:5000').replace(/\/$/,'');const unsubscribe=`${api}/api/alerts/unsubscribe?token=${encodeURIComponent(require('./unsubscribe').token(Number(q.user_id),env))}`;const reference=await sendEmail(q.email,`Rivora: verified official flood ${warning.status.toLowerCase()}`,q.message_text+`\nDashboard: ${base}\nUnsubscribe: ${unsubscribe}\nOfficial station code: ${warning.station.external_station_id}. Coverage checked through ${warning.as_of} KST.\nRivora relays a verified official issuance; it is not the issuing authority. Coverage may be incomplete. Follow instructions from local authorities.`);accepted=true;await db.execute("UPDATE email_notifications SET status='sent',sent_at=UTC_TIMESTAMP(),provider_reference=? WHERE notification_id=? AND status='sending'",[String(reference).slice(0,150),q.notification_id]);sent++;}
  catch(error){
   // Transport timeouts can occur after SMTP acceptance. Do not automatically resend
   // an ambiguous attempt; only an explicit pre-delivery rejection is retryable.
   const rejected=!accepted&&['EAUTH','EENVELOPE','EMESSAGE'].includes(error.code);
   if(rejected)await db.execute("UPDATE email_notifications SET status='failed' WHERE notification_id=? AND status='sending'",[q.notification_id]);
   logger.error(rejected?'[Email] delivery rejected for notification:':'[Email] delivery state needs manual review:',q.notification_id);
  }
 }
 return {status:dry?'DRY_RUN':'COMPLETED',sent,eligible};
}
module.exports={processUnifiedEmailQueue};
