
require('dotenv').config();

const pool = require('./db');

const KMA_STATION = '152';
const HOUR_MS = 60 * 60 * 1000;
const MAX_AGE_HOURS = 3;
const HISTORY_HOURS = 72;

function toNumber(value) {
    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ''
    ) {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) && number >= 0
        ? number
        : null;
}

function round2(value) {
    return Math.round(value * 100) / 100;
}

// Database DATETIME values represent Korean local time.
function toKstMillis(value) {
    if (value instanceof Date) {
        return value.getTime();
    }

    const text = String(value);

    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
        return NaN;
    }

    const date = new Date(
        text.replace(' ', 'T') + '+09:00'
    );

    return date.getTime();
}

function fromKstMillis(ms) {
    return new Date(ms + 9 * HOUR_MS)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
}

function calculateHourlyRainfall(previous, current) {
    // Prefer a genuine reported hourly measurement.
    const direct = toNumber(
        current.hourly_rainfall !== undefined
            ? current.hourly_rainfall
            : current.rainfall
    );

    if (direct !== null) {
        return direct;
    }

    if (!previous || !current) {
        return null;
    }

    const previousTime = toKstMillis(
        previous.observed_at
    );

    const currentTime = toKstMillis(
        current.observed_at
    );

    if (
        !Number.isFinite(previousTime) ||
        !Number.isFinite(currentTime) ||
        currentTime - previousTime !== HOUR_MS
    ) {
        return null;
    }

    // Daily accumulation differences are used only
    // within the same calendar day and source.
    // Do not guess the accumulation reset at midnight.
    if (
        String(previous.observed_at).slice(0, 10) !==
        String(current.observed_at).slice(0, 10)
    ) {
        return null;
    }

    if (
        previous.source &&
        current.source &&
        previous.source !== current.source
    ) {
        return null;
    }

    const previousDaily = toNumber(
        previous.rainfall_day
    );

    const currentDaily = toNumber(
        current.rainfall_day
    );

    if (
        previousDaily === null ||
        currentDaily === null
    ) {
        return null;
    }

    const difference = currentDaily - previousDaily;

    return difference >= 0
        ? round2(difference)
        : null;
}

function calculateWindow(rows, hours) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return {
            hours,
            rainfallMm: null,
            status: 'INSUFFICIENT_DATA',
            available_hours: 0,
            missing_hours: []
        };
    }

    const sorted = [...rows].sort(
        (a, b) =>
            toKstMillis(a.observed_at) -
            toKstMillis(b.observed_at)
    );

    const latest = sorted[sorted.length - 1];
    const endMs = toKstMillis(latest.observed_at);

    if (!Number.isFinite(endMs)) {
        return {
            hours,
            rainfallMm: null,
            status: 'INVALID_TIMESTAMP',
            available_hours: 0,
            missing_hours: []
        };
    }

    const byTime = new Map();

    for (const row of sorted) {
        const time = toKstMillis(row.observed_at);

        if (Number.isFinite(time)) {
            byTime.set(time, row);
        }
    }

    let total = 0;
    let available = 0;
    const missing = [];

    // An hourly rainfall value at time T represents
    // the hourly observation assigned to timestamp T.
    for (let offset = hours - 1; offset >= 0; offset--) {
        const time = endMs - offset * HOUR_MS;

        const current = byTime.get(time);
        const previous = byTime.get(time - HOUR_MS);

        if (!current) {
            missing.push(fromKstMillis(time));
            continue;
        }

        const amount = calculateHourlyRainfall(
            previous,
            current
        );

        if (amount === null) {
            missing.push(fromKstMillis(time));
            continue;
        }

        total += amount;
        available++;
    }

    const complete = available === hours;

    return {
        hours,
        rainfallMm: complete ? round2(total) : null,
        status: complete
            ? 'COMPLETE'
            : 'INCOMPLETE_DATA',
        available_hours: available,
        expected_hours: hours,
        missing_hours: missing,
        start_at: fromKstMillis(
            endMs - (hours - 1) * HOUR_MS
        ),
        end_at: fromKstMillis(endMs)
    };
}

async function analyzeRainfall() {
    const [stations] = await pool.execute(
        `SELECT station_id, station_name
         FROM stations
         WHERE data_source = 'KMA'
           AND external_station_id = ?
         LIMIT 1`,
        [KMA_STATION]
    );

    if (!stations.length) {
        throw new Error('Ulsan KMA station not found');
    }

    const station = stations[0];

    // Retrieve enough history to calculate 24-hour
    // accumulated rainfall despite observation gaps.
    const [weatherRows] = await pool.execute(
        `SELECT
            DATE_FORMAT(
                observed_at,
                '%Y-%m-%d %H:%i:%s'
            ) AS observed_at,
            rainfall,
            rainfall_day
         FROM weather_readings
         WHERE station_id = ?
           AND observed_at >= DATE_SUB(
               UTC_TIMESTAMP() + INTERVAL 9 HOUR,
               INTERVAL ? HOUR
           )
         ORDER BY observed_at ASC`,
        [station.station_id, HISTORY_HOURS]
    );

    const [awsRows] = await pool.execute(
        `SELECT
            DATE_FORMAT(
                observed_at,
                '%Y-%m-%d %H:%i:%s'
            ) AS observed_at,
            hourly_rainfall,
            daily_rainfall
         FROM aws_rainfall_readings
         WHERE aws_station_code = ?
           AND observed_at >= DATE_SUB(
               UTC_TIMESTAMP() + INTERVAL 9 HOUR,
               INTERVAL ? HOUR
           )
         ORDER BY observed_at ASC`,
        [KMA_STATION, HISTORY_HOURS]
    );

    const merged = new Map();

    // ASOS observations are loaded first.
    for (const row of weatherRows) {
        const direct = toNumber(row.rainfall);

        merged.set(row.observed_at, {
            observed_at: row.observed_at,
            hourly_rainfall: direct,
            rainfall_day: row.rainfall_day,
            source: 'KMA_ASOS'
        });
    }

    // AWS supplies hourly rainfall when the
    // corresponding ASOS value is missing.
    for (const row of awsRows) {
        const existing = merged.get(row.observed_at);
        const awsHourly = toNumber(
            row.hourly_rainfall
        );

        if (existing) {
            if (
                existing.hourly_rainfall === null &&
                awsHourly !== null
            ) {
                merged.set(row.observed_at, {
                    observed_at: row.observed_at,
                    hourly_rainfall: awsHourly,
                    rainfall_day: row.daily_rainfall,
                    source: 'KMA_AWS'
                });
            }
        } else {
            merged.set(row.observed_at, {
                observed_at: row.observed_at,
                hourly_rainfall: awsHourly,
                rainfall_day: row.daily_rainfall,
                source: 'KMA_AWS'
            });
        }
    }

    const allRows = [...merged.values()].sort(
        (a, b) =>
            toKstMillis(a.observed_at) -
            toKstMillis(b.observed_at)
    );

    if (!allRows.length) {
        return {
            station: station.station_name,
            observedAt: null,
            status: 'NO_DATA',
            rainfall1h: null,
            rainfall3h: null,
            rainfall6h: null,
            rainfall24h: null
        };
    }

    const latestStationObservation =
        allRows[allRows.length - 1].observed_at;

    // Use the latest observation with an actual
    // non-null hourly rainfall amount.
    // Never interpret missing rainfall as zero.
    const now = Date.now();

    const validRows = allRows.filter(row => {
        const timestamp = toKstMillis(row.observed_at);
        const amount = toNumber(row.hourly_rainfall);

        return (
            Number.isFinite(timestamp) &&
            timestamp <= now &&
            amount !== null
        );
    });

    if (!validRows.length) {
        return {
            station: station.station_name,
            observedAt: latestStationObservation,
            status: 'NO_VALID_HOURLY_RAINFALL',
            rainfall1h: null,
            rainfall3h: null,
            rainfall6h: null,
            rainfall24h: null
        };
    }

    const latestRainfall =
        validRows[validRows.length - 1];

    const latestMs = toKstMillis(
        latestRainfall.observed_at
    );

    const ageHours = (now - latestMs) / HOUR_MS;

    if (
        !Number.isFinite(ageHours) ||
        ageHours < 0 ||
        ageHours > MAX_AGE_HOURS
    ) {
        return {
            station: station.station_name,
            observedAt: latestRainfall.observed_at,
            latestStationObservationAt:
                latestStationObservation,
            status: 'STALE_OBSERVATION',
            data_age_hours: round2(ageHours),
            rainfall1h: null,
            rainfall3h: null,
            rainfall6h: null,
            rainfall24h: null
        };
    }

    // All rainfall windows use the same timestamp.
    // Older ASOS/AWS records provide previous hours.
    const calculationRows = allRows.filter(row =>
        toKstMillis(row.observed_at) <= latestMs
    );

    const rainfall1h = calculateWindow(
        calculationRows, 1
    );

    const rainfall3h = calculateWindow(
        calculationRows, 3
    );

    const rainfall6h = calculateWindow(
        calculationRows, 6
    );

    const rainfall24h = calculateWindow(
        calculationRows, 24
    );

    return {
        station: station.station_name,
        observedAt: latestRainfall.observed_at,
        latestStationObservationAt:
            latestStationObservation,
        status: 'AVAILABLE',
        timezone: 'Asia/Seoul',
        data_age_hours: round2(ageHours),
        rainfall1h,
        rainfall3h,
        rainfall6h,
        rainfall24h,
        floodRisk: 'NOT_ASSESSED',
        note:
            'Rainfall windows are based on the latest ' +
            'available real hourly rainfall observation. ' +
            'Missing hours are not treated as zero.'
    };
}

module.exports = {
    analyzeRainfall,
    calculateHourlyRainfall,
    calculateWindow
};
