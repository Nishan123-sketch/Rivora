const express = require('express');
const pool = require('./db');
const requireAuth = require('./auth-middleware');
const router = express.Router();

// A saved preference is consent, NOT proof that an alert can be generated.
// Weather alert generation is intentionally NOT enabled without verified rules.
router.use('/alert-preferences', requireAuth);

router.get('/alert-preferences', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT station_id, weather_enabled, flood_enabled
      FROM user_alert_preferences WHERE user_id=?`, [req.user.user_id]);
    res.json({
      success: true,
      data: rows,
      capabilities: {
        weather_alert_generation_enabled: false,
        automatic_generation_enabled: process.env.ENABLE_AUTOMATIC_ALERTS === 'true',
        email_delivery_enabled: process.env.ENABLE_AUTOMATIC_ALERTS === 'true' &&
          process.env.ENABLE_ALERT_EMAILS === 'true' &&
          Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_APP_PASSWORD)
      }
    });
  } catch (error) {
    console.error('Preferences lookup failed:', error.code || error.message);
    res.status(503).json({ success: false, message: 'Could not load preferences' });
  }
});

router.put('/alert-preferences', async (req, res) => {
  const { station_id, weather_enabled, flood_enabled } = req.body || {};
  if (!Number.isSafeInteger(station_id) || station_id <= 0 ||
      typeof weather_enabled !== 'boolean' || typeof flood_enabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Select a valid station and notification options' });
  }
  if (!req.user.email_verified) {
    return res.status(403).json({ success: false, message: 'Verify your email before saving alert preferences' });
  }
  try {
    const [stations] = await pool.execute('SELECT station_id FROM stations WHERE station_id=?', [station_id]);
    if (!stations.length) return res.status(404).json({ success: false, message: 'Station not found' });
    await pool.execute(`
      INSERT INTO user_alert_preferences(user_id,station_id,weather_enabled,flood_enabled,consent_at)
      VALUES(?,?,?,?,UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE weather_enabled=VALUES(weather_enabled),
        flood_enabled=VALUES(flood_enabled),consent_at=UTC_TIMESTAMP()`,
      [req.user.user_id, station_id, weather_enabled, flood_enabled]);
    res.json({
      success: true,
      message: 'Preferences saved. Actual delivery requires verified gauge thresholds, automatic alerts enabled, and SMTP configured.'
    });
  } catch (error) {
    console.error('Preference save failed:', error.code || error.message);
    res.status(503).json({ success: false, message: 'Could not save preferences' });
  }
});
module.exports = router;
