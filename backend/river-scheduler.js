
const { importRiverData } = require('./river-importer');

const ONE_HOUR = 60 * 60 * 1000;

let isRunning = false;

async function runRiverImport() {
  if (isRunning) {
    console.log('WAMIS river import already running.');
    return;
  }

  isRunning = true;

  try {
    console.log('Running scheduled WAMIS river import...');

    const result = await importRiverData();

    console.log(
      'WAMIS river update finished:',
      { gauges: result.gauges, saved: result.saved, failed: result.failed }
    );
  } catch (error) {
    console.error(
      'WAMIS river update failed:',
      error.message
    );
  } finally {
    isRunning = false;
  }
}

function startRiverScheduler() {
  console.log('WAMIS river scheduler started.');

  runRiverImport();

  return setInterval(runRiverImport, ONE_HOUR);
}

module.exports = { startRiverScheduler };
