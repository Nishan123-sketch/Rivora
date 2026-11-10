require('dotenv').config();
const fs=require('fs'),path=require('path');
const {rollingStart,retry}=require('./history-backfill');
const parseRainfall=value=>value===null||value===undefined||value===''||value==='-'||!Number.isFinite(Number(value))||Number(value)<0?null:Number(value);
async function backfill({db=require('./db'),fetcher=fetch,env=process.env,start=rollingStart(),end=Date.now()-2*3600000}={}){
 if(!env.KMA_API_KEY)throw Error('KMA_API_KEY is required');
 const [links]=await db.execute("SELECT DISTINCT aws_station_code FROM station_rainfall_links WHERE verification_status IN ('VERIFIED','AUTO_NEAREST')");const codes=new Set(links.map(l=>String(l.aws_station_code)));if(!codes.size)throw Error('No sourced rainfall links. Run link:rainfall first.');
 const file=path.join(__dirname,'reports','completion-rain-checkpoint.json');let done={};try{done=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}fs.mkdirSync(path.dirname(file),{recursive:true});let failures=0;
 for(let t=Date.parse(start+'T00:00:00+09:00');t<=end;t+=3600000){const tm=new Date(t+9*3600000).toISOString().slice(0,16).replace(/[-T:]/g,'');const key=tm+':'+[...codes].sort().join(',');if(done[key])continue;
  try{const url=new URL('https://apihub.kma.go.kr/api/typ01/url/awsh.php');url.search=new URLSearchParams({var:'RN',tm,help:'1',authKey:env.KMA_API_KEY});const text=await retry(async()=>{const r=await fetcher(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('KMA HTTP '+r.status);return r.text();});let count=0;
   for(const line of text.split(/\r?\n/)){const c=line.trim().split(/\s+/);if(c[0]!==tm||!codes.has(c[1])||c.length<14)continue;const hourly=c[7]==='-60'?parseRainfall(c[6]):null;if(hourly===null)continue;await db.execute('INSERT INTO aws_rainfall_readings(aws_station_code,observed_at,hourly_rainfall,daily_rainfall) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE hourly_rainfall=VALUES(hourly_rainfall),daily_rainfall=VALUES(daily_rainfall)',[c[1],new Date(t+9*3600000).toISOString().slice(0,19).replace('T',' '),hourly,parseRainfall(c[4])]);count++;}
   if(count===codes.size)done[key]=true;else failures++;
  }catch{failures++;}
  fs.writeFileSync(file,JSON.stringify(done));await new Promise(r=>setTimeout(r,1000));
 }
 await require('./history-daily').refreshDaily(db);return {failures};
}
if(require.main===module){const db=require('./db');backfill().then(r=>{console.log('Incomplete hourly requests:',r.failures);if(r.failures)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());}
module.exports={backfill};
