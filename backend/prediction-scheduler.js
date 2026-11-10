'use strict';
// Compatibility entry point. Do not run the legacy per-station classifier/fitter
// beside the independently evaluated artifact pipeline.
let running=false;
async function refreshPredictions(){if(running)return {status:'ALREADY_RUNNING'};running=true;try{return await require('./level-pipeline').refresh()}finally{running=false;}}
function startPredictionScheduler(){if(process.env.ENABLE_PREDICTIONS==='false')return;const tick=()=>refreshPredictions().catch(e=>console.error('Saved level prediction job:',e.code||e.message));void tick();const minutes=Number(process.env.PREDICTION_INTERVAL_MINUTES||10),timer=setInterval(tick,Math.max(1,Number.isFinite(minutes)?minutes:10)*60000);timer.unref();return timer;}
module.exports={refreshPredictions,startPredictionScheduler};
