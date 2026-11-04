const {execFile}=require('node:child_process');const path=require('node:path');
let running=false;
function refreshPredictions(){
 if(running)return Promise.resolve({status:'ALREADY_RUNNING'});running=true;
 return new Promise((resolve,reject)=>execFile(process.env.PYTHON_BIN||'python',[path.join(__dirname,'ml/pipeline.py'),'refresh'],{cwd:__dirname,timeout:240000,maxBuffer:2*1024*1024},(err,out)=>{running=false;if(err)return reject(Error('Prediction job failed: check Python dependencies and MySQL connection.'));try{resolve(JSON.parse(out.trim().split('\n').at(-1)))}catch{reject(Error('Invalid prediction job response'));}}));
}
function startPredictionScheduler(){if(process.env.ENABLE_PREDICTIONS==='false')return;const tick=()=>refreshPredictions().catch(e=>console.error(e.message));tick();const minutes=Number(process.env.PREDICTION_INTERVAL_MINUTES||10);return setInterval(tick,Math.max(1,Number.isFinite(minutes)?minutes:10)*60000);}
module.exports={refreshPredictions,startPredictionScheduler};
