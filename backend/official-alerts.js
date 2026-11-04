const pool=require('./db');const iconv=require('iconv-lite');
const SOURCE='https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php';
function parseWarnings(text){
 if(!text.includes('#')||/ERROR|인증|활용신청|<html/i.test(text))throw Error('KMA warning feed rejected or malformed');
 const lines=text.split(/\r?\n/);const header=lines.find(l=>l.startsWith('#')&&/REG_ID/.test(l)&&/WRN/.test(l)&&/LVL/.test(l));
 if(!header)throw Error('KMA warning schema was not recognized');
 const split=l=>l.trim().split(/\s*,\s*|\s+/).filter(Boolean);
 const columns=split(header.replace(/^#+\s*/,''));
 const rows=lines.filter(l=>l.trim()&&!l.trim().startsWith('#')).map(l=>{const values=split(l);if(values.length!==columns.length)throw Error('KMA warning row does not match schema');return Object.fromEntries(columns.map((c,i)=>[c,values[i]]));});
 return rows.map(r=>({region_code:r.REG_ID,area:r.REG_KO||r.REG_ID,type:r.WRN,level:r.LVL,command:r.CMD,issued_at:r.TM_FC,effective_at:r.TM_EF,raw:r}));
}
async function refreshOfficialAlerts(){
 const key=process.env.KMA_ALERT_API_KEY||process.env.KMA_API_KEY;if(!key)return {status:'KEY_REQUIRED'};
 const url=new URL(SOURCE);url.search=new URLSearchParams({fe:'e',tm:'',disp:'0',help:'1',authKey:key});
 const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`KMA alerts HTTP ${r.status}`);
 const alerts=parseWarnings(iconv.decode(Buffer.from(await r.arrayBuffer()),'euc-kr'));
 await pool.execute("INSERT INTO official_alert_snapshots(fetched_at,provider,payload) VALUES(UTC_TIMESTAMP(),'KMA',?)",[JSON.stringify(alerts)]);
 return {status:'UPDATED',count:alerts.length};
}
async function latestOfficialAlerts(){
 const [rows]=await pool.query('SELECT * FROM official_alert_snapshots ORDER BY snapshot_id DESC LIMIT 1');
 if(!rows.length)return {status:'No official feed data',data:[],source:SOURCE};
 const row=rows[0];const data=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
 const age=Date.now()-new Date(row.fetched_at.replace(' ','T')+'Z').getTime();
 return {status:age>=0&&age<=20*60000?'Current':'Stale official feed',fetched_at:row.fetched_at+' UTC',data,source:SOURCE};
}
function startOfficialAlerts(){const tick=()=>refreshOfficialAlerts().catch(e=>console.error('Official alerts:',e.message));tick();return setInterval(tick,10*60000);}
module.exports={parseWarnings,refreshOfficialAlerts,latestOfficialAlerts,startOfficialAlerts};
