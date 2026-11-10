'use strict';
const {time}=require('./risk-engine');
const config=require('./config/risk-config');
const {currentOfficial}=require('./warning-timeline');
async function officialWarning(db,stationId,now=Date.now()){
 const [[station]]=await db.execute("SELECT s.station_id,s.station_name,s.external_station_id FROM stations s WHERE s.station_id=? AND s.data_source='RIVER_GAUGE' AND EXISTS(SELECT 1 FROM river_gauge_links l WHERE l.station_id=s.station_id AND l.verification_status='VERIFIED')",[stationId]);
 if(!station)return null;
 const [coverage]=await db.execute("SELECT * FROM ml_source_coverage WHERE station_code=? AND status='COMPLETE' ORDER BY end_at DESC LIMIT 4",[String(station.external_station_id)]);
 const eligible=coverage.filter(c=>currentOfficial([], [c],now).status!=='UNKNOWN').sort((a,b)=>time(b.end_at)-time(a.end_at));
 const c=eligible[0];if(!c)return null;
 let source;try{source=new URL(c.source_url);if(!['http:','https:'].includes(source.protocol)||!/^(?:www\.)?(?:hrfco|nakdongriver|geumriver|yeongsanriver)\.go\.kr$/.test(source.hostname))return null;}catch{return null;}
 const [events]=await db.execute('SELECT * FROM hr_flood_warning_history WHERE station_code=? AND issued_at BETWEEN ? AND ? ORDER BY issued_at',[String(station.external_station_id),c.start_at,c.end_at]);
 const state=currentOfficial(events,[c],now);if(!['ADVISORY','WARNING'].includes(state.status))return null;
 const event=events.filter(e=>e.action==='ISSUE'&&e.severity===state.status&&/^[a-f0-9]{64}$/i.test(e.event_id)&&time(e.issued_at)<=now&&now-time(e.issued_at)<=24*3600000).at(-1);
 return event?{station,event,status:state.status,source_url:source.href,as_of:state.as_of}:null;
}
async function enqueueOfficialWarnings({db,now=Date.now(),getOfficialWarning=officialWarning}){
 // Exact official station identities only. A same-river link is not warning coverage.
 const [stations]=await db.execute("SELECT DISTINCT s.station_id FROM stations s JOIN hr_flood_warning_history h ON h.station_code=s.external_station_id JOIN user_alert_preferences p ON p.station_id=s.station_id JOIN users u ON u.user_id=p.user_id WHERE s.data_source='RIVER_GAUGE' AND h.action='ISSUE' AND h.issued_at>=UTC_TIMESTAMP()+INTERVAL 9 HOUR-INTERVAL 1 DAY AND p.flood_enabled=1 AND p.consent_at IS NOT NULL AND u.email_verified_at IS NOT NULL AND u.account_status='ACTIVE'");
 let created=0;
 for(const station of stations){const warning=await getOfficialWarning(db,station.station_id,now);if(!warning)continue;const marker=`[Official warning:${warning.event.event_id}]`;const c=await db.getConnection();
  try{await c.beginTransaction();await c.execute('SELECT station_id FROM stations WHERE station_id=? FOR UPDATE',[station.station_id]);
   const [existing]=await c.execute('SELECT alert_id FROM alerts WHERE station_id=? AND message_text LIKE ? FOR UPDATE',[station.station_id,marker+'%']);
   if(existing.length){await c.commit();continue;}
   const name=require('./display-names').englishStationName(warning.station.station_name,warning.station.external_station_id);
   const message=`${marker} Official ${warning.status.toLowerCase()} for ${name}, station ${warning.station.external_station_id}. Issued ${warning.event.issued_at} KST. Source: ${warning.source_url}`.slice(0,500);
   const [result]=await c.execute("INSERT INTO alerts(station_id,alert_type,severity,message_text,status,created_at) VALUES(?,'flood',?,?,'active',UTC_TIMESTAMP())",[station.station_id,warning.status==='WARNING'?'High':'Moderate',message]);
   await c.execute("INSERT IGNORE INTO email_notifications(alert_id,user_id,status) SELECT DISTINCT ?,p.user_id,'queued' FROM user_alert_preferences p JOIN users u ON u.user_id=p.user_id WHERE p.station_id=? AND p.flood_enabled=1 AND p.consent_at IS NOT NULL AND u.email_verified_at IS NOT NULL AND u.account_status='ACTIVE'",[result.insertId,station.station_id]);
   await c.commit();created++;
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }return created;
}
function transition(previous,r,now=Date.now()){
 const s={last_observed_at:null,consecutive_high:0,below_since:null,last_alert_at:null,active_alert_id:null,...previous};
 const fresh=r.data_status==='FRESH'&&r.level&&Number.isFinite(time(r.observed_at))&&now>=time(r.observed_at)&&now-time(r.observed_at)<=config.freshnessHours*3600000;
 if(!fresh)return {...s,consecutive_high:0,below_since:null,action:null};
 if(s.last_observed_at&&time(s.last_observed_at)>=time(r.observed_at))return {...s,action:null};
 const continuous=s.last_observed_at&&time(r.observed_at)-time(s.last_observed_at)<=config.freshnessHours*3600000;
 const high=['High','Severe'].includes(r.level);
 s.consecutive_high=high?(continuous?Number(s.consecutive_high):0)+1:0;
 s.below_since=r.level==='Low'?(continuous?s.below_since||r.observed_at:r.observed_at):null;
 s.last_observed_at=r.observed_at;
 const clear=s.active_alert_id&&s.below_since&&time(r.observed_at)-time(s.below_since)>=config.alert.clearMs;
 const create=high&&!s.active_alert_id&&s.consecutive_high>=config.alert.consecutive&&(!s.last_alert_at||now-time(s.last_alert_at)>=config.alert.cooldownMs);
 return {...s,action:clear?'CLEAR':create?'CREATE':null};
}
function createUnifiedWorker({db=require('./db'),getUnified=require('./risk-engine').getUnified,env=process.env,now=Date.now,logger=console}={}){
 let running=false;
 async function tick(){
  if(env.ENABLE_AUTOMATIC_ALERTS!=='true')return {status:'DISABLED',created:0};if(running)return {status:'RUNNING',created:0};running=true;let created=0;
  try{const officialCreated=await enqueueOfficialWarnings({db,now:now()});const rows=await getUnified();for(const r of rows){const c=await db.getConnection();try{await c.beginTransaction();await c.execute('SELECT station_id FROM stations WHERE station_id=? FOR UPDATE',[r.station_id]);await c.execute('INSERT IGNORE INTO unified_alert_state(station_id) VALUES(?)',[r.station_id]);const [[old]]=await c.execute('SELECT * FROM unified_alert_state WHERE station_id=? FOR UPDATE',[r.station_id]);const s=transition(old,r,now());
   if(s.action==='CLEAR'){await c.execute("UPDATE alerts SET status='resolved',expires_at=UTC_TIMESTAMP() WHERE alert_id=? AND message_text LIKE '[Project advisory]%'",[s.active_alert_id]);s.active_alert_id=null;}
   if(s.action==='CREATE'){
    const message=`[Project advisory] ${r.station_name} (${r.station_id}): ${r.level}; ${r.water_level} m; ${r.basis}; observed ${r.observed_at} KST. Monitoring alert, not an official flood warning. Follow instructions from local authorities.`.slice(0,500);
    const [result]=await c.execute("INSERT INTO alerts(station_id,alert_type,severity,message_text,status,created_at) VALUES(?,'flood',?,?,'active',UTC_TIMESTAMP())",[r.station_id,r.level,message]);s.active_alert_id=result.insertId;s.last_alert_at=new Date(now()+9*3600000).toISOString().slice(0,19).replace('T',' ');
    // Keep project assessments on the dashboard. No separate experimental email consent exists.
   }
   await c.execute('UPDATE unified_alert_state SET last_observed_at=?,consecutive_high=?,below_since=?,last_alert_at=?,active_alert_id=? WHERE station_id=?',[s.last_observed_at,s.consecutive_high,s.below_since,s.last_alert_at,s.active_alert_id,r.station_id]);await c.commit();if(s.action==='CREATE')created++;
  }catch(e){await c.rollback();logger.error('[Unified alert]',r.station_id,e.code||e.message);}finally{c.release();}}
  const email=await require('./email-queue').processUnifiedEmailQueue({db,env,logger});return {status:'COMPLETED',created,official_created:officialCreated,email};
  }finally{running=false;}
 }
 return {tick};
}
function startUnifiedAlerts(){if(process.env.ENABLE_AUTOMATIC_ALERTS!=='true')return null;const worker=createUnifiedWorker();const tick=()=>worker.tick().catch(e=>console.error('[Unified alert]',e.code||e.message));tick();return setInterval(tick,config.intervalMs);}
module.exports={transition,createUnifiedWorker,startUnifiedAlerts,officialWarning,enqueueOfficialWarnings};
