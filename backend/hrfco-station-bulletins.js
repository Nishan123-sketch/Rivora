'use strict';
// Exact WAMIS station-code matching of official HRFCO bulletins.
// The historical archive does NOT certify the live active-warning state.
const {kstTime}=require('./verified-risk-evidence');
function reduceBulletins(rows, now=Date.now()) {
  const output=new Map();
  for(const row of rows){
    const code=String(row.station_code||'');
    if(!/^\d{5,15}$/.test(code)||output.has(code))continue;
    const issuedMs=kstTime(row.issued_at);
    const age=Number.isFinite(issuedMs)?(now-issuedMs)/3600000:null;
    output.set(code,{station_code:code,kind:row.kind,action:row.action,
      severity:row.severity,issued_at:row.issued_at,station_name:row.station_name,
      bulletin_no:row.bulletin_no,
      source:'HRFCO_FLOOD_FORECAST_ISSUANCE',
      is_active_warning:null,
      recency:age!==null&&age>=0&&age<=24?'RECENT_BULLETIN':'HISTORICAL_BULLETIN',
      note:'An archived bulletin is authentic, but does not establish a currently active warning. Cancellations must be applied in event order.'});
  }
  return output;
}
async function latestBulletins(db) {
  try {
    const [rows]=await db.query(`SELECT h.station_code,
      DATE_FORMAT(h.issued_at,'%Y-%m-%d %H:%i:%s') AS issued_at,
      h.kind,h.action,h.severity,h.station_name,h.bulletin_no
      FROM hr_flood_warning_history h
      INNER JOIN (SELECT station_code,MAX(issued_at) AS latest
        FROM hr_flood_warning_history GROUP BY station_code) last
        ON h.station_code=last.station_code AND h.issued_at=last.latest
      ORDER BY h.station_code,h.kind`);
    return {status:'AVAILABLE_HISTORICAL_ONLY',byCode:reduceBulletins(rows),count:rows.length};
  } catch(error) {
    if(error.code==='ER_NO_SUCH_TABLE')return {status:'HISTORY_NOT_IMPORTED',byCode:new Map(),count:0};
    throw error;
  }
}
module.exports={reduceBulletins,latestBulletins};
