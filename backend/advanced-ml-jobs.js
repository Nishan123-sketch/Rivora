let running=false;
async function tick(){
 if(running)return;const report=require('./advanced-ml-service').networkReport();
 if(report?.model_version?.startsWith('level-research-v4')&&Date.now()-Date.parse(report.generated_at)<10*60000)return;
 running=true;try{const fs=require('fs'),path=require('path');let training;try{training=JSON.parse(fs.readFileSync(path.join(__dirname,'reports/level-upgrade/training.json'),'utf8'));}catch{}if(training)await require('./accepted-rain-repair').repairAcceptedRain(require('./db'),training,report);await require('./ml-refresh-network').refresh();}catch(e){console.error('ML network refresh:',e.code||e.message)}finally{running=false;}
}
let syncing=false;
async function syncWarnings(){if(syncing||!process.env.HRFCO_SERVICE_KEY)return;syncing=true;try{const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10).replaceAll('-','');const result=await require('./advanced-hrfco-import').importHistoricalDays([date]);console.log('HRFCO history refresh:',result[0]?.status||'UNAVAILABLE');await require('./collect-geum-warning-archive').collect();await require('./reconcile-geum-warning-archive').reconcile({apply:true});}catch(e){console.error('HRFCO history refresh:',e.code||'UNAVAILABLE')}finally{syncing=false;}}
function start(){if(process.env.ENABLE_ADVANCED_ML_JOBS==='false')return;const first=setTimeout(tick,60000);first.unref();const timer=setInterval(tick,10*60000);timer.unref();const historyFirst=setTimeout(syncWarnings,10000);historyFirst.unref();const historyTimer=setInterval(syncWarnings,10*60000);historyTimer.unref();return timer;}
module.exports={start,tick,syncWarnings};
