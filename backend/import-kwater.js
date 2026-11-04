
require('dotenv').config();

const pool = require('./db');

const BASE_URL =
    'http://apis.data.go.kr/B500001/dam/excllncobsrvt';

const DAM_CODE = '1012110';

// Get today's date in Korean Standard Time
function getKoreanDate() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

// Connect to the K-water API
async function requestKwater(endpoint, params) {
    const apiKey = process.env.KWATER_API_KEY;

    if (!apiKey) {
        throw new Error(
            'KWATER_API_KEY is missing from .env'
        );
    }

    const url = new URL(`${BASE_URL}/${endpoint}`);

    url.searchParams.set('serviceKey', apiKey);
    url.searchParams.set('_type', 'json');

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error(
            `K-water HTTP error: ${response.status}`
        );
    }

    const data = await response.json();

    const header = data.response?.header;

    if (String(header?.resultCode) !== '00') {
        throw new Error(
            `K-water API error: ${header?.resultMsg}`
        );
    }

    return data.response?.body || {};
}

// Convert API response into an array
function getItems(body) {
    const items = body.items?.item;

    if (!items) {
        return [];
    }

    return Array.isArray(items) ? items : [items];
}

// Safely convert measurements into numbers
function validNumber(value) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

// Main K-water importer
async function importKwater() {
    console.log('Starting K-water import...');

    // Step 1: Get real K-water station codes
    const stationBody = await requestKwater(
        'wal/wallist',
        {
            damcode: DAM_CODE
        }
    );

    const stations = getItems(stationBody);

    console.log('Stations found:', stations.length);

    if (stations.length === 0) {
        throw new Error(
            'No K-water monitoring stations returned.'
        );
    }

    const date = getKoreanDate();

    let savedStations = 0;
    let savedReadings = 0;
    let failedStations = 0;

    // Step 2: Process each station
    for (const station of stations) {
        const code = String(
            station.walobsrvtcode || ''
        ).trim();

        const name = String(
            station.obsrvtNm || ''
        ).trim();

        if (!code || !name) {
            console.warn(
                'Skipping station with missing name/code.'
            );
            continue;
        }

        try {
            // Save station without inventing coordinates
            await pool.execute(
                `INSERT INTO stations
                 (
                    station_name,
                    latitude,
                    longitude,
                    data_source,
                    external_station_id
                 )
                 VALUES (?, NULL, NULL, 'KWATER', ?)
                 ON DUPLICATE KEY UPDATE
                    station_name = VALUES(station_name)`,
                [name, code]
            );

            // Get the internal MySQL station ID
            const [stationRows] = await pool.execute(
                `SELECT station_id
                 FROM stations
                 WHERE data_source = 'KWATER'
                   AND external_station_id = ?
                 LIMIT 1`,
                [code]
            );

            if (stationRows.length === 0) {
                throw new Error(
                    'Station not found after insertion.'
                );
            }

            const stationId = stationRows[0].station_id;

            savedStations++;

            console.log(
                `Fetching ${name} (${code})...`
            );

            // Step 3: Request hourly observations
            const observationBody = await requestKwater(
                'hourwal/hourwallist',
                {
                    damcode: DAM_CODE,
                    wal: code,
                    sdate: date,
                    edate: date,
                    stime: '00',
                    etime: '23',
                    pageNo: 1,
                    numOfRows: 100
                }
            );

            const readings = getItems(observationBody);

            // Step 4: Save hourly observations
            for (const reading of readings) {
                const observedAt = String(
                    reading.obsrdt || ''
                ).trim();

                if (
                    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(
                        observedAt
                    )
                ) {
                    continue;
                }

                // Provisional mapping based on the
                // tested response. Confirm with K-water
                // before using values for risk alerts.
                const waterLevel = validNumber(
                    reading.hourwal
                );

                const flowRate = validNumber(
                    reading.flux
                );

                if (
                    waterLevel === null &&
                    flowRate === null
                ) {
                    continue;
                }

                // Store observation timestamp in KST
                await pool.execute(
                    `INSERT INTO water_readings
                     (
                        station_id,
                        observed_at,
                        water_level,
                        flow_rate
                     )
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        water_level = VALUES(water_level),
                        flow_rate = VALUES(flow_rate)`,
                    [
                        stationId,
                        `${observedAt}:00`,
                        waterLevel,
                        flowRate
                    ]
                );

                savedReadings++;
            }

            console.log(
                `Processed ${readings.length} readings`
            );

        } catch (error) {
            failedStations++;

            console.error(
                `Failed station ${name}:`,
                error.message
            );
        }
    }

    console.log('-----------------------------');
    console.log('K-water import finished');
    console.log('Stations processed:', savedStations);
    console.log('Readings processed:', savedReadings);
    console.log('Failed stations:', failedStations);

    if (failedStations > 0) {
        throw new Error(
            `${failedStations} station(s) failed.`
        );
    }
}

// Allow both standalone execution and scheduler use
if (require.main === module) {
    importKwater()
        .catch(error => {
            console.error(
                'Import failed:',
                error.message
            );

            process.exitCode = 1;
        })
        .finally(() => pool.end());
}

module.exports = { importKwater };
