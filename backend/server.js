
require('dotenv').config();
if(process.argv.includes('--frontend'))process.env.ENABLE_FRONTEND='true';

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { findUlsanKma, findTaehwaRiver } = require('./station-defaults');
const authRoutes = require('./auth-routes');


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

const app = express();
if(require.main===module)void require('./local-assistant').ensureLocalAssistant();

app.use(cors({
    credentials:true,
    origin: (origin, cb) => cb(null, !origin || require('./account-sessions').isTrustedOrigin(origin))
}));

app.use(express.json());
app.use(require('./performance-metrics').middleware);
app.use(require('./json-compression').jsonCompression);
if(require.main===module)require('./performance-metrics').start();

// Existing API routes
app.use('/api',require('./account-routes').createRouter());
app.use('/api',require('./admin-routes').createRouter());
app.use('/api', require('./oidc-routes').router);
app.use('/api', require('./unsubscribe').router);
app.use('/api',require('./account-sessions').trustedWrite);
app.use('/api',require('./account-sessions').apiAccess);
app.use('/api', require('./unified-risk-routes'));
app.use('/api', require('./advanced-ml-routes'));
if(require.main===module)require('./advanced-ml-migrate').migrate().then(()=>require('./advanced-ml-jobs').start()).catch(e=>console.error('Advanced ML migration:',e.code||e.message));
app.use('/api', dataRoutes);
app.use('/api', require('./weekly-weather').router);
app.use('/api', require('./monitoring-routes'));
app.use('/api', require('./verified-risk-routes'));
if(require.main===module)require('./assistant-history').migrate().catch(e=>console.error('[Assistant schema]',e.code||'UNAVAILABLE'));
app.use('/api', require('./assistant-history').router);
if(process.env.ENABLE_ASSISTANT_V2!=='false')app.use('/api', require('./assistant-v2-routes').router);
app.use('/api', require('./chat-routes'));
app.use('/api', require('./alert-routes'));
app.use('/api', riverRoutes);
app.use('/api', forecastRoutes);
app.use('/api', floodPredictionRoutes);
app.use('/api', authRoutes);
app.use('/api', require('./preference-routes'));
if(require.main===module){require('./admin-messages').start();require('./account-maintenance').start();}
// NEW: River prediction API
app.use('/api', riverPredictionRoutes);

// Main API route
// Dedicated back-office entry, served by the existing backend and React build.
const adminDist=require('path').join(__dirname,'../frontend/dist');
app.use('/assets',express.static(require('path').join(adminDist,'assets')));
app.get(['/admin','/admin/login'],(req,res)=>{const index=require('path').join(adminDist,'index.html');if(!require('fs').existsSync(index))return res.status(503).send('Build the existing frontend before opening the administrator panel.');res.set('Cache-Control','no-store');return res.sendFile(index);});
app.get('/', (req, res) => {
    if(process.env.ENABLE_FRONTEND==='true')return res.sendFile(require('path').join(__dirname,'../frontend/dist/index.html'));
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

if(process.env.ENABLE_FRONTEND==='true'){app.use(express.static(require('path').join(__dirname,'../frontend/dist')));app.get(['/login','/register','/auth/callback'],(req,res)=>res.sendFile(require('path').join(__dirname,'../frontend/dist/index.html')));}

const port = Number(process.env.PORT) || 5000;

if (require.main === module) app.listen(port, () => {
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
    startKmaScheduler();
    startKmaForecastScheduler();
    startAwsRainfallScheduler();
    void require('./link-nearest-rainfall').run().catch(error=>console.error('Rainfall links:',error.code||error.message));

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
        require('./official-feed-scheduler').start();
    }, 3000);

    // Keep the existing alert system.
    // Unified alert worker starts after its schema migration.
    monitoringReady.then(ok => {
        if (!ok) return console.warn('Prediction and official-alert jobs not started because monitoring tables are missing.');
        require('./migrate-completion').migrate().then(() => {
            require('./hrfco-live-water').start();
            require('./official-warning-archive').start();
            require('./risk-scheduler').startRiskScheduler();
            const aggregate=()=>require('./history-daily').refreshDaily().catch(e=>console.error('[Daily history]',e.code||e.message));
            aggregate();setInterval(aggregate,3600000);
            require('./unified-alerts').startUnifiedAlerts();
        }).catch(e => console.error('[Completion schema]', e.code || e.message));
        require('./prediction-scheduler').startPredictionScheduler();
        require('./official-alerts').startOfficialAlerts();
    });

});

module.exports = app;
