
require('dotenv').config();

const STATION_ID = '152';
const HOURS = 24;

function formatKmaTime(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);

    const values = Object.fromEntries(
        parts.map(part => [part.type, part.value])
    );

    return (
        values.year +
        values.month +
        values.day +
        values.hour +
        values.minute
    );
}

async function fetchObservation(tm) {
    const url = new URL(
        'https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php'
    );

    url.searchParams.set('tm', tm);
    url.searchParams.set('stn', STATION_ID);
    url.searchParams.set('help', '0');
    url.searchParams.set('authKey', process.env.KMA_API_KEY);

    const response = await fetch(url, {
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const body = await response.text();

    const record = body.split(/\r?\n/).find(line =>
        /^\s*\d{12}\s+152\s/.test(line)
    );

    if (!record) {
        return {
            requestedTime: tm,
            status: 'NO_RECORD'
        };
    }

    const columns = record.trim().split(/\s+/);

    return {
        requestedTime: tm,
        returnedTime: columns[0],
        temperature: columns[11],
       rainfall: columns[15],
rainfallDay: columns[16],
rainfallJun: columns[17],
rainfallIntensity: columns[18],
        status: columns[0] === tm ? 'MATCH' : 'TIME_MISMATCH'
    };
}

async function main() {
    if (!process.env.KMA_API_KEY) {
        throw new Error('KMA_API_KEY is missing');
    }

    // Fixed historical period for a reproducible test.
    const end = new Date('2026-10-26T03:00:00Z');

    const results = [];

    for (let i = HOURS - 1; i >= 0; i--) {
        const date = new Date(
            end.getTime() - i * 60 * 60 * 1000
        );

        const tm = formatKmaTime(date);

        try {
            const result = await fetchObservation(tm);
            results.push(result);
        } catch (error) {
            results.push({
                requestedTime: tm,
                status: 'ERROR',
                error: error.message
            });
        }
    }

    console.table(results);

    console.log(
        'Matched records:',
        results.filter(r => r.status === 'MATCH').length
    );

    console.log(
        'Available RN values:',
        results.filter(r =>
            r.status === 'MATCH' &&
            Number.isFinite(Number(r.rainfall)) &&
            Number(r.rainfall) > -9
        ).length
    );
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
