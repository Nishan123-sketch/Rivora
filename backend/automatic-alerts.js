// Educational PROJECT alerts only. No official warning feed is connected.
// Disabled by default; only verified gauge identities + verified station-specific
// flood thresholds and fresh observations may create an advisory.
const { analyzeRiver: defaultAnalyzeRiver } = require('./river-analysis');
const defaultPool = require('./db');
const { sendEmail: defaultSendEmail } = require('./email-service');
const { processEmailQueue } = require('./email-queue');

const severityByStage = Object.freeze({
  INTEREST: 'Low', CAUTION: 'Moderate', ALERT: 'High', SEVERE: 'Severe'
});
const INTERVAL_MS = 5 * 60 * 1000;
const PROJECT_PREFIX = '[Project advisory]';

function createAlertWorker({
  db = defaultPool,
  analyzeRiver = defaultAnalyzeRiver,
  sendEmail = defaultSendEmail,
  env = process.env,
  logger = console
} = {}) {
  let running = false;

  async function evaluateAlerts() {
    if (env.ENABLE_AUTOMATIC_ALERTS !== 'true') return { status: 'DISABLED', assessed: 0, created: 0 };
    if (running) return { status: 'SKIPPED_RUNNING', assessed: 0, created: 0 };
    running = true;
    const stats = { status: 'COMPLETED', assessed: 0, created: 0, skipped: 0, errors: 0 };
    try {
      // A river in the catalog is NOT necessarily a verified live gauge.
      const [stations] = await db.execute(`
        SELECT DISTINCT s.station_id, s.external_station_id
        FROM stations s JOIN river_gauge_links l ON l.station_id=s.station_id
        WHERE s.data_source='RIVER_GAUGE' AND s.external_station_id IS NOT NULL
          AND l.verification_status='VERIFIED'`);
      for (const station of stations) {
        try {
          const observation = await analyzeRiver(station.external_station_id);
          if (observation.risk_status !== 'ASSESSED' ||
              observation.data_freshness?.status !== 'FRESH' ||
              (observation.latest_water_level === null || observation.latest_water_level === undefined || observation.latest_water_level === '' || !Number.isFinite(Number(observation.latest_water_level))) ||
              String(observation.station_id) !== String(station.station_id)) {
            stats.skipped++;
            continue;
          }
          stats.assessed++;
          const severity = severityByStage[observation.risk_level] || null;
          if (!severity && observation.risk_level !== 'NORMAL') { stats.skipped++; continue; }

          const connection = await db.getConnection();
          try {
            await connection.beginTransaction();
            // Lock this station's row to serialize alert creation among processes.
            const [locked] = await connection.execute(
              "SELECT station_id FROM stations WHERE station_id=? AND data_source='RIVER_GAUGE' FOR UPDATE",
              [station.station_id]
            );
            if (!locked.length) { await connection.rollback(); stats.skipped++; continue; }
            const [active] = await connection.execute(`
              SELECT alert_id,severity FROM alerts
              WHERE station_id=? AND alert_type='flood' AND status='active'
                AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP())
                AND message_text LIKE '[Project advisory]%'
              ORDER BY created_at DESC FOR UPDATE`, [station.station_id]);
            // Only resolve project-generated advisories, NEVER external warnings.
            if (!severity) {
              if (active.length) await connection.execute(`
                UPDATE alerts SET status='resolved',expires_at=UTC_TIMESTAMP()
                WHERE station_id=? AND alert_type='flood' AND status='active'
                  AND message_text LIKE '[Project advisory]%'`, [station.station_id]);
              await connection.commit();
              continue;
            }
            if (active.some(row => row.severity === severity)) {
              await connection.commit();
              continue;
            }
            if (active.length) await connection.execute(`
              UPDATE alerts SET status='resolved',expires_at=UTC_TIMESTAMP()
              WHERE station_id=? AND alert_type='flood' AND status='active'
                AND message_text LIKE '[Project advisory]%'`, [station.station_id]);

            const message = `${PROJECT_PREFIX} Gauge ${station.external_station_id}: ${observation.risk_level} reference stage comparison; ` +
              `measured water level ${Number(observation.latest_water_level)} m at ${observation.latest_observed_at} KST. ` +
              'Educational project assessment only. NOT an official flood warning.';
            const [created] = await connection.execute(`
              INSERT INTO alerts(station_id,alert_type,severity,message_text,status,created_at)
              VALUES(?,'flood',?,?,'active',UTC_TIMESTAMP())`,
              [station.station_id, severity, message]);
            await connection.execute(`
              INSERT IGNORE INTO email_notifications(alert_id,user_id,status)
              SELECT ?,p.user_id,'queued'
              FROM user_alert_preferences p JOIN users u ON u.user_id=p.user_id
              WHERE p.station_id=? AND p.flood_enabled=1
                AND u.email_verified_at IS NOT NULL`,
              [created.insertId, station.station_id]);
            await connection.commit();
            stats.created++;
          } catch (error) {
            try { await connection.rollback(); } catch (_) { /* preserve original error */ }
            throw error;
          } finally {
            connection.release();
          }
        } catch (error) {
          stats.errors++;
          logger.error('[Project alert] gauge evaluation failed:', station.station_id, error.message);
        }
      }
      // Emails require a SECOND explicit opt-in and SMTP configuration.
      stats.email = await processEmailQueue({ db, sendEmail, env, logger });
      return stats;
    } finally {
      running = false;
    }
  }
  return { evaluateAlerts };
}

const worker = createAlertWorker();
function startAutomaticAlerts() {
  if (process.env.ENABLE_AUTOMATIC_ALERTS !== 'true') {
    console.log('[Project alerts] disabled by default; no emails will be sent');
    return null;
  }
  worker.evaluateAlerts().catch(e => console.error('[Project alerts]', e.message));
  return setInterval(() => worker.evaluateAlerts().catch(e => console.error('[Project alerts]', e.message)), INTERVAL_MS);
}

module.exports = {
  evaluateAlerts: () => worker.evaluateAlerts(),
  createAlertWorker, startAutomaticAlerts, severityByStage
};
