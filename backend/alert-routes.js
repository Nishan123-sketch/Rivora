const express = require('express');
const pool = require('./db');
const router = express.Router();
router.get('/alerts', async (req, res) => {
  try {
    const [rows] = await pool.execute(`SELECT a.alert_id, a.station_id, s.station_name,
      a.alert_type, a.severity, a.message_text, a.created_at, a.expires_at
      FROM alerts a JOIN stations s ON s.station_id = a.station_id
      WHERE a.status = 'active' AND (a.expires_at IS NULL OR a.expires_at > UTC_TIMESTAMP())
      ORDER BY a.created_at DESC LIMIT 200`);
    const [counts] = await pool.execute(`SELECT COUNT(*) AS count FROM alerts
      WHERE status = 'active' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())`);
    res.json({ success: true, count: Number(counts[0].count), data: rows,
      official_warning_feed_connected: false, automatic_generation_enabled: process.env.ENABLE_AUTOMATIC_ALERTS === 'true',
      email_delivery_enabled: process.env.ENABLE_AUTOMATIC_ALERTS === 'true' && process.env.ENABLE_ALERT_EMAILS === 'true' && Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_APP_PASSWORD),
      weather_alert_generation_enabled: false });
  } catch (error) {
    console.error('Alert query failed:', error.message);
    res.status(503).json({ success: false, message: 'Alert records unavailable' });
  }
});
module.exports = router;
