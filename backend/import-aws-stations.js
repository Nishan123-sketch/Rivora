require('dotenv').config();
const SOURCE='https://apihub.kma.go.kr/api/typ01/url/stn_inf.php';
async function run(db=require('./db'),env=process.env,fetcher=fetch){
 if(!env.KMA_API_KEY)throw Error('KMA_API_KEY is required');const url=new URL(SOURCE);url.search=new URLSearchParams({inf:'AWS',stn:'0',help:'1',authKey:env.KMA_API_KEY});
 const response=await fetcher(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('KMA station metadata HTTP '+response.status);
 const text=require('iconv-lite').decode(Buffer.from(await response.arrayBuffer()),'cp949');let count=0;
 for(const line of text.split(/\r?\n/)){if(!/^\s*\d+\s/.test(line))continue;const c=line.trim().split(/\s+/);const s={longitude:Number(c[1]),latitude:Number(c[2])};if(!require('./geo').located(s)||!c[8])continue;await db.execute('INSERT INTO rainfall_stations(aws_station_code,gauge_name,latitude,longitude,source_url) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE gauge_name=VALUES(gauge_name),latitude=VALUES(latitude),longitude=VALUES(longitude),source_url=VALUES(source_url)',[c[0],c[8],s.latitude,s.longitude,SOURCE+'?inf=AWS&stn=0&help=1']);count++;}
 if(!count)throw Error('No AWS metadata parsed; previous catalog preserved');console.log('Sourced AWS stations:',count);
}
if(require.main===module){const db=require('./db');run(db).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>db.end());}
module.exports={run};
