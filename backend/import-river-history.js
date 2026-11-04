
require('dotenv').config();

const pool = require('./db');

const STATION_CODE = '2201670';

const API_URL =
    'http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_hrdata';

function formatDate(date) {
    return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function convertWamisTime(value) {
    const text = String(value);

    if (!/^\d{10}$/.test(text)) {
        throw new Error('Invalid timestamp: ' + text);
    }

    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(4, 6));
    const day = Number(text.slice(6, 8));
    const hour = Number(text.slice(8, 10));

    if (hour < 1 || hour > 24) {
        throw new Error('Invalid hour: ' + text);
    }

    const baseDate = new Date(Date.UTC(year, month - 1, day));

    if (
        baseDate.getUTCFullYear() !== year ||
        baseDate.getUTCMonth() !== month - 1 ||
        baseDate.getUTCDate() !== day
    ) {
        throw new Error('Invalid date: ' + text);
    }

    const date = new Date(
        Date.UTC(year, month - 1, day, hour)
    );

    return date.toISOString()
        .slice(0, 19)
        .replace('T', ' ');
}

function parseDate(value) {
    if (!/^\d{8}$/.test(value)) {
        throw new Error('Date must be YYYYMMDD');
    }

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));

    const date = new Date(Date.UTC(year, month, day));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month ||
        date.getUTCDate() !== day
    ) {
        throw new Error('Invalid calendar date: ' + value);
    }

    return date;
}

async function importRiverHistory(startDate, endDate) {
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
        ['RIVER_GAUGE', STATION_CODE]
    );

    if (stations.length !== 1) {
        throw new Error('Taehwa River station not found');
    }

    const stationId = stations[0].station_id;

    let totalReturned = 0;
    let totalSaved = 0;
    let totalSkipped = 0;

    // Request data in monthly batches.
    let current = new Date(start);

    while (current <= end) {
        const monthEnd = new Date(Date.UTC(
            current.getUTCFullYear(),
            current.getUTCMonth() + 1,
            0
        ));

        const batchEnd = monthEnd < end ? monthEnd : end;

        const from = formatDate(current);
        const to = formatDate(batchEnd);

        const url = new URL(API_URL);

        url.searchParams.set('obscd', STATION_CODE);
        url.searchParams.set('startdt', from);
        url.searchParams.set('enddt', to);
        url.searchParams.set('output', 'json');

        console.log(`Fetching river history: ${from} - ${to}`);

        const response = await fetch(url, {
            signal: AbortSignal.timeout(60000)
        });

        if (!response.ok) {
            throw new Error(
                `WAMIS HTTP ${response.status} for ${from}`
            );
        }

        const result = await response.json();

        if (
            result.result?.code !== 'success' ||
            !Array.isArray(result.list)
        ) {
            throw new Error(
                'WAMIS API failed: ' +
                (result.result?.msg || 'Unknown error')
            );
        }

        let batchSaved = 0;
        let batchSkipped = 0;

        for (const item of result.list) {
            if (
                item.wl === null ||
                item.wl === undefined ||
                String(item.wl).trim() === ''
            ) {
                batchSkipped++;
                continue;
            }

            const waterLevel = Number(item.wl);

            if (!Number.isFinite(waterLevel)) {
                batchSkipped++;
                continue;
            }

            const observedAt = convertWamisTime(item.ymdh);

            // Keep only timestamps within this requested batch.
            const observedDate = observedAt.slice(0, 10).replaceAll('-', '');

            // WAMIS hour 24 becomes midnight of the next day.
            const dayAfterEnd = new Date(batchEnd);
            dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);

            if (
                observedDate < from ||
                observedDate > formatDate(dayAfterEnd)
            ) {
                batchSkipped++;
                continue;
            }

            await pool.execute(
                `INSERT INTO water_readings
                    (station_id, observed_at, water_level, flow_rate)
                 VALUES (?, ?, ?, NULL)
                 ON DUPLICATE KEY UPDATE
                    water_level = VALUES(water_level)`,
                [stationId, observedAt, waterLevel]
            );

            batchSaved++;
        }

        console.log(
            `Returned: ${result.list.length}, ` +
            `Processed: ${batchSaved}, ` +
            `Skipped: ${batchSkipped}`
        );

        totalReturned += result.list.length;
        totalSaved += batchSaved;
        totalSkipped += batchSkipped;

        current = new Date(batchEnd);
        current.setUTCDate(current.getUTCDate() + 1);
    }

    return {
        station_code: STATION_CODE,
        start_date: startDate,
        end_date: endDate,
        returned: totalReturned,
        processed: totalSaved,
        skipped: totalSkipped
    };
}

if (require.main === module) {
    const startDate = process.argv[2];
    const endDate = process.argv[3];

    if (!startDate || !endDate) {
        console.error(
            'Usage: node import-river-history.js YYYYMMDD YYYYMMDD'
        );
        process.exitCode = 1;
        pool.end();
    } else {
        importRiverHistory(startDate, endDate)
            .then(result => {
                console.log(
                    'Historical river import completed:'
                );
                console.log(JSON.stringify(result, null, 2));
            })
            .catch(error => {
                console.error(
                    'Historical river import failed:',
                    error.message
                );
                process.exitCode = 1;
            })
            .finally(async () => {
                await pool.end();
            });
    }
}

module.exports = { importRiverHistory };
