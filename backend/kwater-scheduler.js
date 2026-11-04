
const { importKwater } = require('./import-kwater');

const ONE_HOUR = 60 * 60 * 1000;

let isRunning = false;

async function runKwaterImport() {
    if (isRunning) {
        console.log('K-water import already running.');
        return;
    }

    isRunning = true;

    try {
        console.log('Running scheduled K-water import...');
        await importKwater();
        console.log('K-water update completed.');
    } catch (error) {
        console.error(
            'K-water update failed:',
            error.message
        );
    } finally {
        isRunning = false;
    }
}

function startKwaterScheduler() {
    console.log('K-water scheduler started.');

    // Run immediately when the server starts
    runKwaterImport();

    // Repeat every hour
    return setInterval(runKwaterImport, ONE_HOUR);
}

module.exports = { startKwaterScheduler };
