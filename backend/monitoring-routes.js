const router=require('express').Router();
const {summaries,history}=require('./monitoring-store');
router.get('/monitoring/stations/:id/rainfall',async(req,res)=>{try{
 if(!/^\d+$/.test(req.params.id))return res.status(400).json({success:false,message:'Invalid station ID'});
 const allowed=await require('./official-station-policy').visibleIds();if(!allowed.has(String(req.params.id)))return res.status(404).json({success:false,message:'Station unavailable'});
 // A newer empty report must not hide a valid recent observation from this gauge.
 // The selected timestamp belongs to the value displayed; stale or future values remain unavailable.
 const [[row]]=await require('./db').execute(`SELECT s.station_id,l.aws_station_code,l.gauge_name,l.distance_km,a.hourly_rainfall AS rainfall,a.observed_at AS rainfall_observed_at FROM stations s LEFT JOIN station_rainfall_links l ON l.station_id=s.station_id AND l.verification_status IN ('VERIFIED','AUTO_NEAREST') LEFT JOIN aws_rainfall_readings a ON a.aws_station_code=l.aws_station_code AND a.observed_at=(SELECT MAX(observed_at) FROM aws_rainfall_readings WHERE aws_station_code=l.aws_station_code AND hourly_rainfall IS NOT NULL AND hourly_rainfall>=0 AND observed_at BETWEEN UTC_TIMESTAMP()+INTERVAL 9 HOUR-INTERVAL 3 HOUR AND UTC_TIMESTAMP()+INTERVAL 9 HOUR) WHERE s.station_id=?`,[req.params.id]);
 if(!row)return res.status(404).json({success:false,message:'Station unavailable'});res.json({success:true,data:row});
 }catch(e){console.error('Station rainfall:',e.code||e.message);res.status(503).json({success:false,message:'Rainfall service unavailable'});}});
router.get('/monitoring/stations',async(req,res)=>{try{const data=await require('./official-station-policy').publicStations(await summaries());res.json({success:true,data});}catch(e){console.error('Monitoring:',e.code||e.message);res.status(503).json({success:false,message:'Monitoring database is not ready. Check the database connection and run npm run setup:monitoring.'});}});
router.get('/history',async(req,res)=>{
 const id=req.query.station_id||'all';
 if(id!=='all'&&(!/^\d+$/.test(id)||Number(id)<=0))return res.status(400).json({message:'Invalid station ID'});
 try{require('./monitoring-store').dateRange(req.query);}catch(e){return res.status(400).json({message:e.message});}
 try{const result=await history(id,req.query);const allowed=await require('./official-station-policy').visibleIds();for(const field of ['water','weather','rainfall','risks','predictions'])if(Array.isArray(result[field]))result[field]=result[field].filter(r=>allowed.has(String(r.station_id)));res.json(result);}catch(e){console.error('History:',e.code||e.message);res.status(503).json({message:'History database is not ready. Check the database connection and monitoring setup.'});}
});
router.get('/official-alerts',async(req,res)=>{try{let official=await require('./official-alerts').latestOfficialAlerts();try{official=await require('./wind-alerts').enrichWindAlerts(official);}catch{/* Issued warnings remain visible without station speeds. */}res.json({success:true,...official});}catch{res.status(503).json({message:'Official alert storage is not ready'});}});
router.get('/ml/metrics',(req,res)=>{try{res.json(JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'ml/classification_metrics.json'),'utf8')));}catch{res.json({stations:{},message:'Train the station models to generate evaluation metrics.'});}});
router.get('/risk-alerts',async(req,res)=>{try{res.json(await require('./risk-alerts').riskAlerts());}catch{res.status(503).json({message:'Risk assessment data could not be loaded.'});}});
router.get('/map/rivers',async(req,res)=>{try{const maps=require('./map-data');const data=req.query.view==='catalog'?await maps.mapCatalog():req.query.view==='map'?maps.compactMap(await maps.mapData()):await maps.mapData();res.json({success:true,data});}catch{res.status(503).json({message:'River locations could not be loaded. Check monitoring database setup.'});}});
router.get('/map/stations/:id',async(req,res)=>{if(!/^\d+$/.test(req.params.id)||!Number.isSafeInteger(Number(req.params.id))||Number(req.params.id)<=0)return res.status(400).json({message:'Invalid station ID'});try{const data=await require('./map-data').stationDetails(Number(req.params.id));return data?res.json({success:true,data}):res.status(404).json({message:'Verified monitoring station unavailable.'});}catch{res.status(503).json({message:'Selected-station details are unavailable. Please retry.'});}});
module.exports=router;
