const {currentOfficial}=require('./warning-timeline');
let cached=null,pending=null;
async function states(db=require('./db')){
 if(cached&&Date.now()-cached.at<60000)return cached.data;if(pending)return pending;
 pending=(async()=>{const [coverage]=await db.query("SELECT * FROM ml_source_coverage WHERE status='COMPLETE' AND start_at<=UTC_TIMESTAMP()+INTERVAL 9 HOUR AND end_at BETWEEN UTC_TIMESTAMP()+INTERVAL 9 HOUR-INTERVAL 20 MINUTE AND UTC_TIMESTAMP()+INTERVAL 9 HOUR AND checked_at>=UTC_TIMESTAMP()-INTERVAL 20 MINUTE");const result=new Map();
  const codes=[...new Set(coverage.map(c=>String(c.station_code)))];const [allEvents]=codes.length?await db.query('SELECT * FROM hr_flood_warning_history WHERE station_code IN ('+codes.map(()=>'?').join(',')+') ORDER BY station_code,issued_at',codes):[[]];for(const code of codes)result.set(code,currentOfficial(allEvents.filter(e=>String(e.station_code)===code),coverage.filter(c=>String(c.station_code)===code)));cached={at:Date.now(),data:result};return result;
 })().finally(()=>pending=null);return pending;
}
async function overlay(rows){let official=new Map();try{official=await states()}catch{/* Unknown coverage never overrides measured stage comparisons. */}
 return rows.map(row=>{const current=official.get(String(row.external_station_id))||{status:'UNKNOWN',level:null,reason:'NO_FRESH_COMPLETE_WARNING_COVERAGE'};
  return {...row,observed_stage_level:row.level,official_warning_status:current.status,official_warning_detail:current,display_source:current.level?'Official warning':row.tier==='A'?'Verified flood stage':row.level?'Experimental':row.water_level!=null?'Not assessed':'No data',...(current.level?{level:current.level,official_warning:true}:{})};});
}
module.exports={states,overlay};
