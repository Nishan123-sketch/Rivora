
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { findUlsanKma, findTaehwaRiver } = require('./station-defaults');
const authRoutes = require('./auth-routes');
const { startAutomaticAlerts } = require('./automatic-alerts');

const dataRoutes = require('./data-routes');
const riverRoutes = require('./river-routes');
const forecastRoutes = require('./forecast-routes');
const floodPredictionRoutes = require('./flood-prediction-routes');
const {
    startAwsRainfallScheduler
} = require('./aws-rainfall-scheduler');

// NEW: River water-level prediction routes
const riverPredictionRoutes = require('./river-prediction');

const { startKmaScheduler } = require('./kma-scheduler');
const { startKwaterScheduler } = require('./kwater-scheduler');
const { startRiverScheduler } = require('./river-scheduler');

// Automatic KMA weather forecast scheduler
const {
    startKmaForecastScheduler
} = require('./kma-forecast-scheduler');

// Combined weather and river monitoring analysis
const {
    analyzeCombinedConditions
} = require('./combined-analysis');

// A failing background job (importer, scheduler, Python call) must never take the API down.
// Node >= 15 terminates the process on an unhandled promise rejection, which makes the
// frontend report "cannot reach the server" for every request.
if (require.main === module) {
    process.on('unhandledRejection', (reason) => {
        console.error('[unhandledRejection]', reason && reason.message ? reason.message : reason);
    });
    process.on('uncaughtException', (error) => {
        console.error('[uncaughtException]', error && error.stack ? error.stack : error);
    });
}

const app = express();

app.use(cors({
    // Any local dev origin (Vite may pick 5174, 127.0.0.1, etc.)
    origin: (origin, cb) => cb(null, !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
}));

// gzip API responses (large JSON lists shrink ~5-10x). Optional: skipped if not installed yet (run npm install).
try { app.use(require('compression')()); } catch { console.warn('compression not installed - run: npm install'); }

app.use(express.json());

// Short cache for expensive read-only endpoints (ML fit, nationwide summaries) that every
// open browser re-requests each minute. Seconds are configurable via API_CACHE_SECONDS.
const { responseCache } = require('./ttl-cache');
const apiCache = responseCache(Number(process.env.API_CACHE_SECONDS || 30) * 1000);
app.get([
    '/api/rivers/:stationId/prediction',
    '/api/monitoring/stations',
    '/api/risk-alerts',
    '/api/map/rivers',
    '/api/river-catalog',
    '/api/combined-analysis',
    '/api/alerts'
], apiCache);

// Existing API routes
app.use('/api', dataRoutes);
app.use('/api', require('./monitoring-routes'));
app.use('/api', require('./chat-routes'));
app.use('/api', require('./alert-routes'));
app.use('/api', riverRoutes);
app.use('/api', forecastRoutes);
app.use('/api', floodPredictionRoutes);
app.use('/api', authRoutes);
app.use('/api', require('./preference-routes'));
// NEW: River prediction API
app.use('/api', riverPredictionRoutes);

// Main API route
app.get('/', (req, res) => {
    res.json({
        message: 'Weather and Flood Risk Forecasting API'
    });
});

// Database health check
app.get('/api/health', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT DATABASE() AS database_name'
        );

        res.json({
            status: 'ok',
            database: rows[0].database_name
        });

    } catch (error) {
        console.error(
            'Database health check failed:',
            error.message
        );

        res.status(503).json({
            status: 'error',
            message: 'Database connection failed'
        });
    }
});

// Default station IDs resolved from provider codes (not hardcoded DB IDs)
app.get('/api/defaults', async (req, res) => {
    try {
        const [kma, river] = await Promise.all([findUlsanKma(), findTaehwaRiver()]);
        res.json({
            success: true,
            kma_station_id: kma ? kma.station_id : null,
            river_station_id: river ? river.station_id : null
        });
    } catch (error) {
        console.error('Defaults lookup failed:', error.message);
        res.status(503).json({ success: false, message: 'Default stations unavailable' });
    }
});

// Existing station endpoint
app.get('/api/stations', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT
                station_id,
                station_name,
                latitude,
                longitude,
                data_source
             FROM stations
             ORDER BY station_name`
        );

        res.json(rows);

    } catch (error) {
        console.error(
            'Station query failed:',
            error.message
        );

        res.status(500).json({
            message: 'Could not load stations'
        });
    }
});

// Combined weather and river monitoring endpoint
app.get('/api/combined-analysis', async (req, res) => {
    try {
        const result = await analyzeCombinedConditions();

        res.json(result);

    } catch (error) {
        console.error(
            'Combined analysis failed:',
            error.message
        );

        res.status(500).json({
            status: 'error',
            message: 'Could not load combined analysis'
        });
    }
});

const port = Number(process.env.PORT) || 5000;

if (require.main === module) { const server = app.listen(port, () => {
    console.log(
        `Backend running at http://localhost:${port}`
    );

    // Startup diagnostic: tells you immediately if the database is the problem
    pool.query('SELECT COUNT(*) AS n FROM stations').then(([r]) => {
        console.log(`Database OK. stations table has ${r[0].n} rows.`);
        if (!Number(r[0].n)) console.warn('WARNING: stations table is empty - the frontend will show "unavailable". Run the importers (import-kma-stations.js, import-river-history.js / river-importer.js).');
    }).catch(e => console.error(`DATABASE ERROR: ${e.code || ''} ${e.message}\n -> Check MySQL is running and DB_HOST/DB_USER/DB_PASSWORD/DB_NAME in backend/.env, then run: npm run migrate`));

    // Create the monitoring tables if they are missing (safe: CREATE TABLE IF NOT EXISTS,
    // never touches existing observations). Prevents ER_NO_SUCH_TABLE on upgraded databases.
    const monitoringReady = require('./setup-monitoring').setup().then(() => true).catch(e => {
        console.error(`MONITORING TABLES NOT CREATED: ${e.code || ''} ${e.message}\n -> The database user needs CREATE permission, or run database/monitoring.sql manually in MySQL Workbench.`);
        return false;
    });

    // Existing automatic KMA weather updates
   
    // Start the lightweight weather schedulers normally.
    // Delayed a few seconds so the API answers the first dashboard requests before the
    // importers start competing for database connections and the event loop.
    setTimeout(() => {
        startKmaScheduler();
        startKmaForecastScheduler();
        startAwsRainfallScheduler();
    }, 5000);

    // Stagger the river-related schedulers to avoid
    // starting multiple large imports simultaneously.
    setTimeout(() => {
        console.log('Starting K-water scheduler...');
        if (process.env.ENABLE_LEGACY_KWATER_SCHEDULER === 'true') {
            startKwaterScheduler();
        } else {
            console.log('Legacy K-water scheduler disabled; WAMIS monitoring remains enabled.');
        }
    }, 15000);

    setTimeout(() => {
        console.log('Starting WAMIS river scheduler...');
        startRiverScheduler();
    }, 60000);

    // Keep the existing alert system.
    startAutomaticAlerts();
    monitoringReady.then(ok => {
        if (!ok) return console.warn('Prediction and official-alert jobs not started because monitoring tables are missing.');
        // Delay the first Python prediction run so it does not compete with the first dashboard requests.
        setTimeout(() => require('./prediction-scheduler').startPredictionScheduler(), 30000);
        require('./official-alerts').startOfficialAlerts();
    });

});

// Close the HTTP server and the MySQL pool cleanly on Ctrl+C / process stop.
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
        console.log(`${sig} received, shutting down...`);
        server.close(() => pool.end().catch(() => {}).finally(() => process.exit(0)));
        setTimeout(() => process.exit(0), 5000).unref();
    });
}

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`PORT ${port} IS ALREADY IN USE by another program, so this backend cannot start.\n -> Close the other process (Windows: netstat -ano | findstr :${port} , then taskkill /PID <pid> /F) or change PORT in backend/.env AND the proxy target in frontend/vite.config.js.`);
    } else {
        console.error('Server error:', error.message);
    }
    process.exit(1);
});
}

module.exports = app;
