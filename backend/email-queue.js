// Persistent, opt-in delivery queue. Never claims SMTP delivery without a sendMail result.
// A 'sending' job deliberately requires manual review if the process crashes mid-send:
// automatically repeating it might send a duplicate warning.
const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = 15;

function canSendAlertEmail(env) {
  return env.ENABLE_AUTOMATIC_ALERTS === 'true' &&
    env.ENABLE_ALERT_EMAILS === 'true' &&
    Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_APP_PASSWORD);
}

async function processEmailQueue({ db, sendEmail, env = process.env, logger = console, limit = 20 }) {
  if (!canSendAlertEmail(env)) return { status: 'DISABLED', sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  const [queue] = await db.execute(`
    SELECT n.notification_id,u.email,a.message_text,a.severity
    FROM email_notifications n JOIN users u ON u.user_id=n.user_id
    JOIN alerts a ON a.alert_id=n.alert_id
    JOIN user_alert_preferences p ON p.user_id=u.user_id AND p.station_id=a.station_id
    WHERE (n.status='queued' OR (n.status='failed' AND n.attempted_at <
      DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)))
      AND n.attempt_count < 3
      AND a.status='active' AND a.alert_type='flood'
      AND a.message_text LIKE '[Project advisory]%'
      AND (a.expires_at IS NULL OR a.expires_at>UTC_TIMESTAMP())
      AND p.flood_enabled=1 AND u.email_verified_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM flood_thresholds t WHERE t.station_id=a.station_id
        AND t.verification_status='VERIFIED' AND t.verified_at IS NOT NULL
        AND t.source_url IS NOT NULL AND t.interest_level_m IS NOT NULL
        AND t.interest_level_m < t.caution_level_m
        AND t.caution_level_m < t.alert_level_m
        AND t.alert_level_m < t.severe_level_m)
      AND EXISTS (SELECT 1 FROM water_readings w WHERE w.station_id=a.station_id
        AND w.water_level IS NOT NULL
        AND w.observed_at >= DATE_SUB(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),INTERVAL 3 HOUR))
    ORDER BY n.notification_id LIMIT ?`, [Math.min(100,Math.max(1,limit))]);

  for (const entry of queue) {
    const [claim] = await db.execute(`
      UPDATE email_notifications SET status='sending',attempted_at=UTC_TIMESTAMP(),
        attempt_count=attempt_count+1
      WHERE notification_id=? AND attempt_count < 3 AND
        (status='queued' OR (status='failed' AND attempted_at <
          DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE)))`, [entry.notification_id]);
    if (claim.affectedRows !== 1) continue;
    try {
      const id = await sendEmail(
        entry.email,
        `UNOFFICIAL river-stage project advisory (${entry.severity})`,
        entry.message_text + '\n\nThis is an educational prototype, not an official emergency warning. Consult Korean authorities for official alerts.'
      );
      await db.execute(`UPDATE email_notifications
        SET status='sent',sent_at=UTC_TIMESTAMP(),provider_reference=?
        WHERE notification_id=? AND status='sending'`,
      [String(id || '').slice(0,150), entry.notification_id]);
      sent++;
    } catch (error) {
      // Do not log users' email addresses or SMTP secrets.
      logger.error('[Project email] send failed; notification id:', entry.notification_id);
      try {
        await db.execute(`UPDATE email_notifications SET status='failed'
          WHERE notification_id=? AND status='sending'`, [entry.notification_id]);
      } catch (_) { /* remains 'sending' for manual review; do not auto-retry */ }
      failed++;
    }
  }
  return { status: 'COMPLETED', sent, failed };
}
module.exports = { processEmailQueue, canSendAlertEmail, MAX_ATTEMPTS, RETRY_MINUTES };
