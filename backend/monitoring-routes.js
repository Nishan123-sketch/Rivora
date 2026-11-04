const router=require('express').Router();
const {summaries,history}=require('./monitoring-store');
router.get('/monitoring/stations',async(req,res)=>{try{const data=await summaries();res.json({success:true,data});}catch(e){console.error('Monitoring:',e.code||e.message);res.status(503).json({success:false,message:'Monitoring database is not ready. Check the database connection and run npm run setup:monitoring.'});}});
router.get('/history',async(req,res)=>{
 const id=req.query.station_id||'all';
 if(id!=='all'&&(!/^\d+$/.test(id)||Number(id)<=0))return res.status(400).json({message:'Invalid station ID'});
 try{require('./monitoring-store').dateRange(req.query);}catch(e){return res.status(400).json({message:e.message});}
 try{res.json(await history(id,req.query));}catch(e){console.error('History:',e.code||e.message);res.status(503).json({message:'History database is not ready. Check the database connection and monitoring setup.'});}
});
router.get('/official-alerts',async(req,res)=>{try{res.json({success:true,...await require('./official-alerts').latestOfficialAlerts()});}catch{res.status(503).json({message:'Official alert storage is not ready'});}});
router.get('/ml/metrics',(req,res)=>{try{res.json(JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'ml/classification_metrics.json'),'utf8')));}catch{res.json({stations:{},message:'Train the station models to generate evaluation metrics.'});}});
router.get('/risk-alerts',async(req,res)=>{try{res.json(await require('./risk-alerts').riskAlerts());}catch{res.status(503).json({message:'Risk assessment data could not be loaded.'});}});
router.get('/map/rivers',async(req,res)=>{try{res.json({success:true,data:await require('./map-data').mapData()});}catch{res.status(503).json({message:'River locations could not be loaded. Check monitoring database setup.'});}});
module.exports=router;
