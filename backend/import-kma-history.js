
require('dotenv').config();

const pool = require('./db');

const KMA_STATION = '152';
const REQUEST_DELAY_MS = 300;
const HOUR_MS = 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * HOUR_MS;

function parseDateArgument(value, endOfDay = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(
            'Date must use YYYY-MM-DD format: ' + value
        );
    }

    const date = new Date(
        value + (endOfDay
            ? 'T23:00:00+09:00'
            : 'T00:00:00+09:00')
    );

    if (!Number.isFinite(date.getTime())) {
        throw new Error('Invalid date: ' + value);
    }

    const reconstructed = new Date(
        date.getTime() + KST_OFFSET_MS
    ).toISOString().slice(0, 10);

    if (reconstructed !== value) {
        throw new Error('Invalid calendar date: ' + value);
    }

    return date;
}

function formatKmaTime(date) {
    return new Date(
        date.getTime() + KST_OFFSET_MS
    ).toISOString().slice(0, 16)
        .replace(/[-T:]/g, '');
}

function formatMysqlTime(tm) {
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

    return Number.isFinite(number) && number > -9
        ? number
        : null;
}

function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}

async function fetchObservation(tm) {
    const url = new URL(
        'https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php'
    );

    url.searchParams.set('tm', tm);
    url.searchParams.set('stn', KMA_STATION);
    url.searchParams.set('help', '0');
    url.searchParams.set(
        'authKey',
        process.env.KMA_API_KEY
    );

    const response = await fetch(url, {
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error(
            `KMA HTTP ${response.status} for ${tm}`
        );
    }

    const body = await response.text();

    const record = body.split(/\r?\n/).find(line =>
        /^\s*\d{12}\s+152\s/.test(line)
    );

    if (!record) {
        throw new Error(
            'No KMA observation returned for ' + tm
        );
    }

    const columns = record.trim().split(/\s+/);

    if (
        columns.length < 19 ||
        columns[0] !== tm
    ) {
        throw new Error(
            'Invalid KMA observation for ' + tm
        );
    }

    return {
        observedAt: formatMysqlTime(tm),
        temperature: parseNumber(columns[11]),
        rainfall: parseNumber(columns[15]),
        rainfallDay: parseNumber(columns[16])
    };
}

async function importKmaHistory() {
    if (!process.env.KMA_API_KEY) {
        throw new Error(
            'KMA_API_KEY is missing from .env'
        );
    }

    const startDate =
        process.argv[2] || '2026-10-27';

    const endDate =
        process.argv[3] || '2026-10-30';

    const start = parseDateArgument(startDate);
    const end = parseDateArgument(endDate, true);

    if (start > end) {
        throw new Error(
            'Start date must not be after end date'
        );
    }

    const now = Date.now();

    const [stations] = await pool.execute(
        `SELECT station_id
         FROM stations
         WHERE data_source = 'KMA'
           AND external_station_id = ?
         LIMIT 1`,
        [KMA_STATION]
    );

    if (!stations.length) {
        throw new Error(
            'Ulsan KMA station not found'
        );
    }

    const stationId = stations[0].station_id;

    let processed = 0;
    let withRainfall = 0;
    let missingRainfall = 0;
    let failed = 0;
    let futureSkipped = 0;

    console.log(
        `Importing KMA history: ${startDate} to ${endDate}`
    );

    for (
        let timestamp = start.getTime();
        timestamp <= end.getTime();
        timestamp += HOUR_MS
    ) {
        // Do not request observations in the future.
        if (timestamp > now) {
            futureSkipped++;
            continue;
        }

        const tm = formatKmaTime(
            new Date(timestamp)
        );

        try {
            const observation =
                await fetchObservation(tm);

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

            processed++;

            if (observation.rainfall === null) {
                missingRainfall++;
            } else {
                withRainfall++;
            }

            console.log(
                tm,
                'TA:', observation.temperature,
                'RN:', observation.rainfall,
                'RN_DAY:', observation.rainfallDay
            );

        } catch (error) {
            failed++;

            console.error(
                'Failed:',
                tm,
                error.message
            );
        }

        await sleep(REQUEST_DELAY_MS);
    }

    console.log('\nHistorical import completed.');
    console.log('Processed:', processed);
    console.log('With RN:', withRainfall);
    console.log('Missing RN:', missingRainfall);
    console.log('Failed:', failed);
    console.log('Future hours skipped:', futureSkipped);
    console.log(
        'Rainfall reporting intervals still require validation.'
    );
}

importKmaHistory()
    .catch(error => {
        console.error(
            'Historical import failed:',
            error.message
        );

        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
