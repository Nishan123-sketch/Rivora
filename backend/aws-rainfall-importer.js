
require('dotenv').config();

const pool = require('./db');

const API_URL =
    'https://apihub.kma.go.kr/api/typ01/url/awsh.php';

const HOUR_MS = 3600000;

function getKoreaHour(offsetHours = 0) {
    const date = new Date(
        Date.now() - offsetHours * HOUR_MS
    );

    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);

    const p = Object.fromEntries(
        parts.map(x => [x.type, x.value])
    );

    return `${p.year}${p.month}${p.day}${p.hour}00`;
}

function parseRainfall(value) {
    if (
        value === undefined ||
        value === null ||
        value === '-' ||
        value === ''
    ) {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) && number >= 0
        ? number
        : null;
}

function mysqlDate(tm) {
    return (
        `${tm.slice(0, 4)}-${tm.slice(4, 6)}-` +
        `${tm.slice(6, 8)} ${tm.slice(8, 10)}:` +
        `${tm.slice(10, 12)}:00`
    );
}

async function importAwsRainfall(offsetHours = 2) {
    const apiKey = process.env.KMA_API_KEY;

    if (!apiKey) {
        throw new Error('KMA_API_KEY missing');
    }

    if (
        !Number.isInteger(offsetHours) ||
        offsetHours < 1 ||
        offsetHours > 168
    ) {
        throw new Error(
            'AWS offset must be between 1 and 168 hours'
        );
    }

    const tm = getKoreaHour(offsetHours);

    const url = new URL(API_URL);

    url.searchParams.set('var', 'RN');
    url.searchParams.set('tm', tm);
    url.searchParams.set('help', '1');
    url.searchParams.set('authKey', apiKey);

    const response = await fetch(url, {
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error(
            `AWS API HTTP ${response.status}`
        );
    }

    const body = await response.text();
    const lines = body.split(/\r?\n/);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let validRainfall = 0;
    let matched = 0;

    for (const line of lines) {
        if (!/^\s*\d{12}\s+\d+\s/.test(line)) {
            continue;
        }

        const c = line.trim().split(/\s+/);

        if (c.length < 14 || c[0] !== tm) {
            skipped++;
            continue;
        }

        matched++;

        const stationCode = c[1];

        // Existing project field mapping.
        // Verify against the full KMA column header.
        const dailyRainfall = parseRainfall(c[4]);

        const hourlyRainfall =
            c[7] === '-60'
                ? parseRainfall(c[6])
                : null;

        if (hourlyRainfall !== null) {
            validRainfall++;
        }

        // No valid rainfall measurement:
        // avoid creating an unusable observation row.
        if (
            hourlyRainfall === null &&
            dailyRainfall === null
        ) {
            skipped++;
            continue;
        }

        // COALESCE protects existing valid observations
        // when the new API response has NULL values.
        const [result] = await pool.execute(
            `INSERT INTO aws_rainfall_readings
                (
                    aws_station_code,
                    observed_at,
                    hourly_rainfall,
                    daily_rainfall
                )
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                hourly_rainfall = COALESCE(
                    VALUES(hourly_rainfall),
                    hourly_rainfall
                ),
                daily_rainfall = COALESCE(
                    VALUES(daily_rainfall),
                    daily_rainfall
                )`,
            [
                stationCode,
                mysqlDate(tm),
                hourlyRainfall,
                dailyRainfall
            ]
        );

        if (result.affectedRows === 1) {
            inserted++;
        } else {
            updated++;
        }
    }

    if (matched === 0) {
        throw new Error(
            `No matching AWS station records for ${tm}`
        );
    }

    console.log(
        `[AWS] ${tm}: inserted=${inserted}, ` +
        `updated=${updated}, ` +
        `valid_hourly=${validRainfall}, ` +
        `skipped=${skipped}`
    );

    return {
        requested_time: tm,
        matched,
        inserted,
        updated,
        valid_hourly: validRainfall,
        skipped
    };
}

if (require.main === module) {
    importAwsRainfall()
        .then(result => {
            console.log(
                JSON.stringify(result, null, 2)
            );
        })
        .catch(error => {
            console.error(error.message);
            process.exitCode = 1;
        })
        .finally(async () => {
            await pool.end();
        });
}

module.exports = {
    importAwsRainfall
};
