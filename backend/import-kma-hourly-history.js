
require('dotenv').config();

const pool = require('./db');

const STATION_CODE = '152';
const API_URL =
    'https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php';

const DELAY_MS = 350;
const MAX_ATTEMPTS = 3;
const HOUR_MS = 60 * 60 * 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDate(text) {
    if (!/^\d{8}$/.test(text)) {
        throw new Error('Use YYYYMMDD date format');
    }

    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(4, 6)) - 1;
    const day = Number(text.slice(6, 8));

    const date = new Date(Date.UTC(year, month, day));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month ||
        date.getUTCDate() !== day
    ) {
        throw new Error('Invalid date: ' + text);
    }

    return date;
}

function formatTimestamp(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');

    return `${y}${m}${d}${h}00`;
}

function mysqlTimestamp(tm) {
    return (
        `${tm.slice(0, 4)}-${tm.slice(4, 6)}-` +
        `${tm.slice(6, 8)} ${tm.slice(8, 10)}:` +
        `${tm.slice(10, 12)}:00`
    );
}

function parseNumber(value) {
    if (
        value === undefined ||
        value === null ||
        value === '' ||
        value === '-'
    ) {
        return null;
    }

    const number = Number(value);

    if (!Number.isFinite(number) || number <= -9) {
        return null;
    }

    return number;
}

function parseObservation(body, expectedTm) {
    const lines = body.split(/\r?\n/);

    const matchingLines = lines.filter(line =>
        new RegExp(`^\\s*${expectedTm}\\s+152\\s`).test(line)
    );

    if (matchingLines.length !== 1) {
        throw new Error(
            `Expected one observation for ${expectedTm}, ` +
            `found ${matchingLines.length}`
        );
    }

    // Some KMA numeric fields touch each other:
    // -9.0-9.0 becomes -9.0 -9.0
    const normalized = matchingLines[0].replace(
        /(\d)(?=-\d)/g,
        '$1 '
    );

    const columns = normalized.trim().split(/\s+/);

    if (
        columns.length < 17 ||
        columns[0] !== expectedTm ||
        columns[1] !== STATION_CODE
    ) {
        throw new Error(
            `Invalid observation format for ${expectedTm}`
        );
    }

    return {
        observedAt: mysqlTimestamp(expectedTm),
        temperature: parseNumber(columns[11]),
        rainfall: parseNumber(columns[15]),
        rainfallDay: parseNumber(columns[16])
    };
}

async function fetchObservation(tm) {
    const url = new URL(API_URL);

    url.searchParams.set('tm', tm);
    url.searchParams.set('stn', STATION_CODE);
    url.searchParams.set('help', '0');
    url.searchParams.set('authKey', process.env.KMA_API_KEY);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(30000)
            });

            if (response.status === 401 ||
                response.status === 403) {
                throw new Error(
                    `KMA_ACCESS_DENIED: HTTP ${response.status}`
                );
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const body = await response.text();

            return parseObservation(body, tm);

        } catch (error) {
            if (error.message.startsWith('KMA_ACCESS_DENIED')) {
                throw error;
            }

            if (attempt === MAX_ATTEMPTS) {
                throw error;
            }

            console.log(
                `Retry ${attempt}/${MAX_ATTEMPTS}: ${tm} - ` +
                error.message
            );

            await sleep(attempt * 1500);
        }
    }
}

async function importHistory(startDate, endDate) {
    if (!process.env.KMA_API_KEY) {
        throw new Error('KMA_API_KEY missing');
    }

    const start = parseDate(startDate);
    const end = parseDate(endDate);

    if (start > end) {
        throw new Error('Start date is after end date');
    }

    const [stations] = await pool.execute(
        `SELECT station_id
         FROM stations
         WHERE data_source = ?
           AND external_station_id = ?`,
        ['KMA', STATION_CODE]
    );

    if (stations.length !== 1) {
        throw new Error('Ulsan station not found in MySQL');
    }

    const stationId = stations[0].station_id;

    // WAMIS historical timestamps run from
    // first date 01:00 to the day after the end date 00:00.
    const firstHour = new Date(
        start.getTime() + HOUR_MS
    );

    const finalHour = new Date(
        end.getTime() + 24 * HOUR_MS
    );

    const stats = {
        station_id: stationId,
        start_date: startDate,
        end_date: endDate,
        requested: 0,
        processed: 0,
        valid_rainfall: 0,
        missing_rainfall: 0,
        failed: 0
    };

    console.log(
        `Importing KMA observations: ` +
        `${formatTimestamp(firstHour)} to ` +
        `${formatTimestamp(finalHour)}`
    );

    for (
        let current = firstHour.getTime();
        current <= finalHour.getTime();
        current += HOUR_MS
    ) {
        const tm = formatTimestamp(new Date(current));

        stats.requested++;

        try {
            const observation = await fetchObservation(tm);

            await pool.execute(
                `INSERT INTO weather_readings
                    (
                        station_id,
                        observed_at,
                        temperature,
                        rainfall,
                        rainfall_day
                    )
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    temperature = COALESCE(
                        VALUES(temperature),
                        temperature
                    ),
                    rainfall = COALESCE(
                        VALUES(rainfall),
                        rainfall
                    ),
                    rainfall_day = COALESCE(
                        VALUES(rainfall_day),
                        rainfall_day
                    )`,
                [
                    stationId,
                    observation.observedAt,
                    observation.temperature,
                    observation.rainfall,
                    observation.rainfallDay
                ]
            );

            stats.processed++;

            if (observation.rainfall === null) {
                stats.missing_rainfall++;
            } else {
                stats.valid_rainfall++;
            }

        } catch (error) {
            stats.failed++;

            console.error(
                `FAILED ${tm}: ${error.message}`
            );

            if (error.message.startsWith('KMA_ACCESS_DENIED')) {
                console.error(
                    'Stopping because API access was denied.'
                );
                break;
            }
        }

        if (stats.requested % 24 === 0) {
            console.log(
                `Progress: ${stats.requested} requested, ` +
                `${stats.processed} processed, ` +
                `${stats.failed} failed`
            );
        }

        if (current < finalHour.getTime()) {
            await sleep(DELAY_MS);
        }
    }

    return stats;
}

if (require.main === module) {
    const startDate = process.argv[2];
    const endDate = process.argv[3];

    if (!startDate || !endDate) {
        console.error(
            'Usage: node import-kma-hourly-history.js ' +
            'YYYYMMDD YYYYMMDD'
        );

        process.exitCode = 1;
        pool.end();

    } else {
        importHistory(startDate, endDate)
            .then(result => {
                console.log('\nImport summary:');
                console.log(JSON.stringify(result, null, 2));

                if (result.failed > 0) {
                    process.exitCode = 1;
                }
            })
            .catch(error => {
                console.error('Import failed:', error.message);
                process.exitCode = 1;
            })
            .finally(async () => {
                await pool.end();
            });
    }
}

module.exports = { importHistory };
