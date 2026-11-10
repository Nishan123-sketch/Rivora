'use strict';
const router=require('express').Router();
router.get('/risk/ai-outlook/:stationId',async(req,res)=>{
  const id=Number(req.params.stationId);
  if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({success:false,message:'Invalid station ID'});
  try {
    const {getOutlook}=require('./ai-water-level-outlook');
    const data=await getOutlook(id);
    return data?res.json(data):res.status(404).json({success:false,message:'No verified WAMIS gauge found'});
  }catch(e){console.error('AI outlook:',e.code||e.message);return res.status(503).json({success:false,message:'River-level forecast unavailable'});}
});
router.get('/risk/warning-history/:stationId',async(req,res)=>{
  const id=Number(req.params.stationId);
  if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({success:false,message:'Invalid station ID'});
  try {
    const db=require('./db');const {historyForGauge}=require('./hrfco-warning-history');
    const data=await historyForGauge(db,id);
    return data?res.json({success:true,...data}):res.status(404).json({success:false,message:'Gauge not found'});
  }catch(e){console.error('HRFCO history:',e.code||e.message);return res.status(503).json({success:false,message:'Historical warnings table unavailable; run npm run import:hrfco-history'});}
});
module.exports=router;
