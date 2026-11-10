'use strict';

const { importRiverBatch } = require('./river-importer');

const configuredMinutes=Number(process.env.RIVER_IMPORT_INTERVAL_MINUTES);
const IMPORT_INTERVAL_MS=(Number.isFinite(configuredMinutes)&&configuredMinutes>=1&&configuredMinutes<=60?configuredMinutes:5)*60000;
const configuredBatch=Number(process.env.RIVER_IMPORT_BATCH_SIZE);
const batchSize=Number.isInteger(configuredBatch)&&configuredBatch>=1&&configuredBatch<=96?configuredBatch:48;
let isRunning = false;
let timer = null;

async function runRiverImport() {
  if (isRunning) {
    console.log('[WAMIS live] Previous batch still running; skipping this tick.');
    return;
  }
  isRunning = true;
  try {
    const result = await importRiverBatch({ batchSize });
    if (result.skipped) {
      console.log('[WAMIS live] Batch skipped:', result.reason);
      return;
    }
    console.log('[WAMIS live] Batch finished:', {
      total_gauges: result.gauges,
      attempted: result.attempted,
      saved_or_updated: result.saved,
      failed: result.failed
    });
    const errors = result.results.filter(row => row.error).slice(0, 4);
    for (const row of errors) console.warn(`[WAMIS live] ${row.code}: ${row.error}`);
  } catch (error) {
    console.error('[WAMIS live] Batch failed:', error.message);
  } finally {
    isRunning = false;
  }
}

function startRiverScheduler() {
  if (timer) return timer;
  console.log(`[WAMIS live] Rotating scheduler started (${batchSize} gauges per batch; default 5 min interval).`);
  void runRiverImport();
  timer = setInterval(() => void runRiverImport(), IMPORT_INTERVAL_MS);
  return timer;
}

module.exports = { startRiverScheduler, runRiverImport };
