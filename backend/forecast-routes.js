
const express = require('express');
const pool = require('./db');
const { findUlsanKma } = require('./station-defaults');

const router = express.Router();
const { importKmaForecast } = require('./import-kma-forecast');
const importLocks = new Map();
router.post('/weather/forecast/import', async (req,res) => {
  const stationId=Number(req.body?.station_id);
  if (!Number.isSafeInteger(stationId)||stationId<1) return res.status(400).json({success:false,message:'Invalid station ID'});
  const [rows]=await pool.execute("SELECT station_id FROM stations WHERE station_id=? AND data_source='KMA' LIMIT 1",[stationId]);
  if (!rows.length) return res.status(404).json({success:false,message:'KMA station not found'});
  if(importLocks.has(stationId))return res.status(409).json({success:false,message:'A forecast refresh for this station is already running.'});
  importLocks.set(stationId,true);
  try { const result=await importKmaForecast(stationId);return res.json({success:true,station_id:stationId,...result}); }
  catch(e){ console.error('Forecast import failed:',e.message);const message=e.code==='KMA_KEY_MISSING'?'KMA forecast service is not configured on the server.':e.code==='KMA_HTTP_ERROR'?'KMA forecast service returned an HTTP error.':e.code==='KMA_RESPONSE_ERROR'?`KMA rejected the forecast request: ${e.publicMessage||'check the KMA service configuration and request parameters'}`:e.code==='KMA_EMPTY_FORECAST'?'KMA returned no forecast records for this location and issue time.':e.code==='KMA_DATABASE_ERROR'?'The KMA forecast was retrieved, but could not be saved to the database.':'KMA forecast import failed. Check the backend logs for details.';return res.status(503).json({success:false,code:e.code||'FORECAST_IMPORT_FAILED',message}); }
  finally{importLocks.delete(stationId);}
});


// Latest KMA forecast issue for Ulsan
router.get('/weather/forecast', async (req, res) => {
    try {
        let stationId = req.query.station_id === undefined ? null : Number(req.query.station_id);
        if (stationId === null) { const d = await findUlsanKma(); if (!d) return res.status(404).json({success:false,message:'Default Ulsan KMA station not found in stations table'}); stationId = Number(d.station_id); }
        if (!Number.isSafeInteger(stationId) || stationId < 1) return res.status(400).json({success:false,message:'Invalid station ID'});
        const [stations] = await pool.execute("SELECT station_name FROM stations WHERE station_id = ? AND data_source = 'KMA'", [stationId]);
        if (!stations.length) return res.status(404).json({success:false,message:'Weather station not found'});
        const [[latest]] = await pool.execute(
            `SELECT MAX(issued_at) AS latest_issue_at FROM weather_forecasts WHERE station_id=? AND source=?`,
            [stationId,'KMA_VILAGE_FCST']
        );
        const [rows] = await pool.execute(
            `SELECT
                forecast_id,
                station_id,
                issued_at,
                valid_at,
                rainfall_forecast,
                temperature_forecast,
                precipitation_probability, humidity_forecast, wind_speed_forecast,
                precipitation_raw, precipitation_min_mm, precipitation_max_mm, precipitation_max_exclusive,
                source
             FROM weather_forecasts
             WHERE station_id = ?
               AND source = ?
               AND valid_at >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR)
               AND issued_at = (
                   SELECT MAX(issued_at)
                   FROM weather_forecasts
                   WHERE station_id = ?
                     AND source = ?
                     AND valid_at >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR)
               )
             ORDER BY valid_at ASC`,
            [
                stationId,
                'KMA_VILAGE_FCST',
                stationId,
                'KMA_VILAGE_FCST'
            ]
        );

        res.json({
            station_id: stationId,
            station_name: stations[0].station_name,
            forecast_type: 'KMA_SHORT_TERM',
            timezone: 'Asia/Seoul',
            latest_issue_at: latest?.latest_issue_at || null,
            count: rows.length,
            forecasts: rows
        });
    } catch (error) {
        console.error(
            'Weather forecast query failed:',
            error.message
        );

        res.status(500).json({
            status: 'error',
            message: 'Could not load weather forecasts'
        });
    }
});

module.exports = router;
