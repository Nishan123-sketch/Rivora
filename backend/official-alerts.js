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
async function refreshOfficialAlertsApi(){
 const key=process.env.KMA_ALERT_API_KEY||process.env.KMA_API_KEY;if(!key)return {status:'KEY_REQUIRED'};
 const url=new URL(SOURCE);url.search=new URLSearchParams({fe:'e',tm:'',disp:'0',help:'1',authKey:key});
 const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`KMA alerts HTTP ${r.status}`);
 const alerts=parseWarnings(iconv.decode(Buffer.from(await r.arrayBuffer()),'euc-kr'));
 await pool.execute("INSERT INTO official_alert_snapshots(fetched_at,provider,payload) VALUES(UTC_TIMESTAMP(),'KMA',?)",[JSON.stringify(alerts)]);
 return {status:'UPDATED',count:alerts.length};
}

const PUBLIC_SOURCE='https://www.weather.go.kr/w/wnuri-fct2021/weather/warning.do';
function parsePublicWarnings(html){const table=html.replace(/<!--[\s\S]*?-->/g,'').match(/<table\b[^>]*id="current-warnings"[^>]*>([\s\S]*?)<\/table>/i)?.[1];if(!table)throw Error('Public warning table unavailable');const clean=s=>s.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();const rows=[...table.matchAll(/<tr\b[^>]*data-type="([A-Z])"[^>]*data-level="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>{const cells=[...m[3].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c=>clean(c[1]));if(cells.length<5)throw Error('Incomplete public warning row');return {type:m[1],level:m[2],area:cells[2],area_en:require('./display-names').romanizeKorean(cells[2]),issued_at:cells[3],effective_at:cells[4],command:'ACTIVE',provider:'KMA',source_url:PUBLIC_SOURCE};});if(!rows.length&&!/없|발효.*특보.*없/.test(clean(table)))throw Error('Warning table empty without confirmed no-warning message');return rows;}
async function refreshPublicAlerts(){const response=await fetch(PUBLIC_SOURCE,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Public warnings unavailable');const alerts=parsePublicWarnings(await response.text());await pool.execute("INSERT INTO official_alert_snapshots(fetched_at,provider,payload) VALUES(UTC_TIMESTAMP(),'KMA',?)",[JSON.stringify(alerts)]);return {status:'UPDATED',count:alerts.length,source:'KMA_PUBLIC'};}

async function refreshOfficialAlerts(){try{const result=await refreshOfficialAlertsApi();if(result.status==='UPDATED')return result;}catch{/* The public official warning table does not require an API subscription. */}return refreshPublicAlerts();}
async function latestOfficialAlerts(db=pool){
 const [rows]=await (db.query?db.query.bind(db):db.execute.bind(db))('SELECT * FROM official_alert_snapshots ORDER BY snapshot_id DESC LIMIT 1');
 if(!rows.length)return {status:'No official feed data',data:[],source:SOURCE};
 const row=rows[0];const data=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
 const age=Date.now()-new Date(row.fetched_at.replace(' ','T')+'Z').getTime();
 return {status:age>=0&&age<=20*60000?'Current':'Stale official feed',fetched_at:row.fetched_at+' UTC',data,source:SOURCE};
}
function startOfficialAlerts(){const tick=()=>refreshOfficialAlerts().catch(e=>console.error('Official alerts:',e.message));tick();return setInterval(tick,10*60000);}
module.exports={parsePublicWarnings,refreshPublicAlerts,parseWarnings,refreshOfficialAlerts,latestOfficialAlerts,startOfficialAlerts};
