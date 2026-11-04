
const { importKmaWeather } = require('./import-kma-weather');

const INTERVAL_MS = 60 * 60 * 1000;

let isRunning = false;

async function runKmaImport() {
    if (isRunning) {
        console.log('KMA import already running. Skipping.');
        return;
    }

    isRunning = true;

    try {
        console.log(
            '[KMA Scheduler] Starting:',
            new Date().toLocaleString('en-GB', {
                timeZone: 'Asia/Seoul'
            })
        );

        await importKmaWeather();

        console.log('[KMA Scheduler] Run finished.');

    } catch (error) {
        console.error(
            '[KMA Scheduler] Import error:',
            error.message
        );
    } finally {
        isRunning = false;
    }
}

function startKmaScheduler() {
    console.log('Automatic KMA scheduler started.');

    // Fetch immediately when the backend starts.
    runKmaImport();

    // Repeat every hour while the backend is running.
    return setInterval(runKmaImport, INTERVAL_MS);
}

module.exports = { startKmaScheduler };
