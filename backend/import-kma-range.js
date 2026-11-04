
require('dotenv').config();

const pool = require('./db');

const STATION_CODE = '152';
const API_URL =
    'https://apihub.kma.go.kr/api/typ01/url/kma_sfctm3.php';

const BATCH_DAYS = 10;
const REQUEST_DELAY_MS = 500;
const MAX_ATTEMPTS = 3;

function parseDate(text) {
    if (!/^\d{8}$/.test(text)) {
        throw new Error('Date must be YYYYMMDD');
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

function addDays(date, days) {
    return new Date(
        date.getTime() + days * 24 * 60 * 60 * 1000
    );
}

function dateText(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function mysqlTime(tm) {
    return (
        tm.slice(0, 4) + '-' +
        tm.slice(4, 6) + '-' +
        tm.slice(6, 8) + ' ' +
        tm.slice(8, 10) + ':' +
        tm.slice(10, 12) + ':00'
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchBatch(tm1, tm2) {
    const url = new URL(API_URL);

    url.searchParams.set('tm1', tm1);
    url.searchParams.set('tm2', tm2);
    url.searchParams.set('stn', STATION_CODE);
    url.searchParams.set('help', '0');
    url.searchParams.set('authKey', process.env.KMA_API_KEY);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(90000)
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            const body = await response.text();

            const lines = body.split(/\r?\n/);

            const records = lines.filter(line =>
                /^\s*\d{12}\s+152\s/.test(line)
            );

            if (records.length === 0) {
                throw new Error(
                    'No observation rows returned. Response: ' +
                    body.slice(-250)
                );
            }

            return records;

        } catch (error) {
            console.error(
                `Attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
                error.message
            );

            if (attempt === MAX_ATTEMPTS) {
                throw error;
            }

            await sleep(attempt * 2000);
        }
    }
}

async function importKmaRange(startDate, endDate) {
    if (!process.env.KMA_API_KEY) {
        throw new Error('KMA_API_KEY missing from .env');
    }

    const start = parseDate(startDate);
    const end = parseDate(endDate);

    if (start > end) {
        throw new Error('Start date must be before end date');
    }

    const [stations] = await pool.execute(
        `SELECT station_id
         FROM stations
         WHERE data_source = ?
           AND external_station_id = ?`,
        ['KMA', STATION_CODE]
    );

    if (stations.length !== 1) {
        throw new Error('Ulsan KMA station not found');
    }

    const stationId = stations[0].station_id;

    const totals = {
        station_id: stationId,
        station_code: STATION_CODE,
        start_date: startDate,
        end_date: endDate,
        batches_completed: 0,
        api_rows: 0,
        saved: 0,
        missing_rainfall: 0,
        failed_rows: 0
    };

    let current = new Date(start);

    while (current <= end) {
        const candidateEnd = addDays(current, BATCH_DAYS - 1);
        const batchEnd = candidateEnd < end ? candidateEnd : end;

        // Match WAMIS hourly coverage:
        // first day 01:00 through midnight after final day.
        const tm1 = dateText(current) + '0100';
        const tm2 = dateText(addDays(batchEnd, 1)) + '0000';

        console.log(`\nFetching KMA: ${tm1} - ${tm2}`);

        const records = await fetchBatch(tm1, tm2);

        let batchSaved = 0;
        let batchMissingRainfall = 0;
        let batchFailed = 0;

        for (const line of records) {
            try {
                const columns = line.trim().split(/\s+/);

                if (
                    columns.length < 17 ||
                    !/^\d{12}$/.test(columns[0]) ||
                    columns[1] !== STATION_CODE
                ) {
                    throw new Error('Invalid KMA observation row');
                }

                const tm = columns[0];

                if (tm < tm1 || tm > tm2) {
                    throw new Error('Timestamp outside requested range');
                }

                const temperature = parseNumber(columns[11]);
                const rainfall = parseNumber(columns[15]);
                const rainfallDay = parseNumber(columns[16]);

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
                        mysqlTime(tm),
                        temperature,
                        rainfall,
                        rainfallDay
                    ]
                );

                batchSaved++;

                if (rainfall === null) {
                    batchMissingRainfall++;
                }

            } catch (error) {
                batchFailed++;
                console.error('Row failed:', error.message);
            }
        }

        totals.api_rows += records.length;
        totals.saved += batchSaved;
        totals.missing_rainfall += batchMissingRainfall;
        totals.failed_rows += batchFailed;
        totals.batches_completed++;

        console.log('API rows:', records.length);
        console.log('Processed:', batchSaved);
        console.log('Missing RN:', batchMissingRainfall);
        console.log('Failed rows:', batchFailed);

        current = addDays(batchEnd, 1);

        if (current <= end) {
            await sleep(REQUEST_DELAY_MS);
        }
    }

    return totals;
}

if (require.main === module) {
    const startDate = process.argv[2] || '20260601';
    const endDate = process.argv[3] || '20260930';

    importKmaRange(startDate, endDate)
        .then(result => {
            console.log('\nKMA historical import completed.');
            console.log(JSON.stringify(result, null, 2));
        })
        .catch(error => {
            console.error(
                'KMA historical import failed:',
                error.message
            );
            process.exitCode = 1;
        })
        .finally(async () => {
            await pool.end();
        });
}

module.exports = { importKmaRange };
