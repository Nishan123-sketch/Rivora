'use strict';
const router = require('express').Router();
const {coverage} = require('./verified-risk-evidence');
const getAssessments=async()=> (await require('./risk-engine').getUnified()).map(r=>({...r,risk_level:r.level,risk_score:r.score,risk_basis:r.basis,water_level_m:r.water_level,observation_status:r.observation_freshness||r.data_status,stage_evidence_verified:r.tier==='A',assessment_status:r.level?'ASSESSED':'NOT_ASSESSED',reason:r.reasons.join(', ')}));
const getAssessmentById=async id=>(await getAssessments()).find(r=>String(r.station_id)===String(id));

// JSON overview and per-gauge evidence. No calls to remote services on page load.
router.get('/risk/coverage', async (req, res) => {
  try { return res.json({success:true, ...coverage(await getAssessments())}); }
  catch (e) { console.error('Risk coverage:', e.code || e.message);
    return res.status(503).json({success:false,message:'Risk evidence database unavailable'}); }
});
router.get('/risk/gauges', async (req, res) => {
  try {
    const data = await getAssessments();
    return res.json({success:true,count:data.length,coverage:coverage(data),data});
  } catch (e) { console.error('Risk gauges:', e.code || e.message);
    return res.status(503).json({success:false,message:'Risk evidence database unavailable'}); }
});
router.get('/risk/gauges/:stationId', async (req, res) => {
  const id = Number(req.params.stationId);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({success:false,message:'Invalid station ID'});
  try {
    const data = await getAssessmentById(id);
    return data ? res.json({success:true,data}) : res.status(404).json({success:false,message:'Verified WAMIS gauge not found'});
  } catch (e) { console.error('Risk gauge:', e.code || e.message);
    return res.status(503).json({success:false,message:'Risk evidence database unavailable'}); }
});
// Experimental relative-level screening, separate from official flood risk.
router.get('/risk/experimental-levels', async (req, res) => {
  try {
    const {getScreening} = require('./experimental-gauge-screening');
    return res.json(await getScreening());
  } catch (error) {
    console.error('Experimental level screening:', error.code || error.message);
    return res.status(503).json({success: false, message: 'Historical screening unavailable'});
  }
});
module.exports = router;
