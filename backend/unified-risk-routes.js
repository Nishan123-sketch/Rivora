const router=require('express').Router();
const {getUnified}=require('./risk-engine');
router.get(['/risk/unified','/risk/unified/:stationId'],async(req,res)=>{
 const id=req.params.stationId;if(id&&(!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<=0))return res.status(400).json({message:'Invalid station ID'});
 try{const rows=await getUnified();const data=id?rows.find(r=>String(r.station_id)===id):rows;if(!data)return res.status(404).json({message:'Gauge not found'});res.json({success:true,data});}catch{res.status(503).json({message:'Unified risk database unavailable'});}
});
module.exports=router;
