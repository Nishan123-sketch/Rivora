require('dotenv').config();

const pool = require('./db');

function parseKmaNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= -9) return null;
    return number;
}

function formatKmaDate(value) {
    if (!/^\d{12}$/.test(value)) {
        throw new Error('Invalid KMA observation date: ' + value);
    }

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(8, 10));
    const minute = Number(value.slice(10, 12));
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day ||
        date.getUTCHours() !== hour ||
        date.getUTCMinutes() !== minute
    ) {
        throw new Error('Invalid KMA observation date: ' + value);
    }

    // KMA observation timestamps are Korean local (KST) wall-clock times.
    return (
        value.slice(0, 4) + '-' +
        value.slice(4, 6) + '-' +
        value.slice(6, 8) + ' ' +
        value.slice(8, 10) + ':' +
        value.slice(10, 12) + ':00'
    );
}

async function importKmaWeather() {
    if (!process.env.KMA_API_KEY) {
        throw new Error('KMA_API_KEY is missing from .env');
    }

    const url = new URL('https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php');
    url.searchParams.set('stn', '0');
    url.searchParams.set('help', '0');
    url.searchParams.set('authKey', process.env.KMA_API_KEY);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    console.log('Fetching real KMA weather observations...');
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    console.log('KMA HTTP status:', response.status);

    if (!response.ok) throw new Error(`KMA API HTTP ${response.status}`);

    const body = await response.text();
    const records = body.split(/\r?\n/).filter(line => /^\s*\d{12}\s+\d+\s/.test(line));
    console.log('API records:', records.length);

    if (records.length === 0) {
        throw new Error('KMA returned no valid observation records. Response preview: ' + body.slice(0, 300));
    }

    const [stations] = await pool.query(`
        SELECT station_id, external_station_id
        FROM stations
        WHERE data_source = 'KMA'
    `);
    const stationMap = new Map(stations.map(station => [
        String(station.external_station_id), station.station_id
    ]));

    for (const line of records) {
        try {
            const columns = line.trim().split(/\s+/);
            const externalId = columns[1];
            const stationId = stationMap.get(externalId);

            if (!stationId) {
                skipped++;
                console.warn('Unknown KMA station:', externalId);
                continue;
            }

            const observedAt = formatKmaDate(columns[0]);
            // Confirmed KMA kma_sfctm2 column positions:
            const windSpeed = parseKmaNumber(columns[3]);   // WS (m/s)
            const temperature = parseKmaNumber(columns[11]); // TA (°C)
            const humidity = parseKmaNumber(columns[13]);    // HM (%)
            const rainfall = parseKmaNumber(columns[15]);    // RN (mm); -9 = missing

            const [result] = await pool.query(`
                INSERT INTO weather_readings
                    (station_id, observed_at, rainfall, temperature, humidity, wind_speed)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    temperature = COALESCE(VALUES(temperature), temperature),
                    rainfall = COALESCE(VALUES(rainfall), rainfall),
                    humidity = COALESCE(VALUES(humidity), humidity),
                    wind_speed = COALESCE(VALUES(wind_speed), wind_speed)
            `, [stationId, observedAt, rainfall, temperature, humidity, windSpeed]);

            if (result.affectedRows === 1) imported++;
            else if (result.affectedRows === 2) updated++;
            else skipped++;
        } catch (recordError) {
            failed++;
            console.error('Record import failed:', recordError.message);
        }
    }

    console.log('\nKMA weather import completed.');
    console.log('API records:', records.length);
    console.log('Inserted:', imported);
    console.log('Updated:', updated);
    console.log('Unchanged or skipped:', skipped);
    console.log('Failed:', failed);

    if (failed > 0) throw new Error(`${failed} KMA observation records failed to import`);

    return { apiRecords: records.length, imported, updated, skipped, failed };
}

module.exports = { importKmaWeather };

if (require.main === module) {
    importKmaWeather()
        .catch(error => {
            console.error('KMA weather import failed:', error.message);
            process.exitCode = 1;
        })
        .finally(async () => { await pool.end(); });
}
