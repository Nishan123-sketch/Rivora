
require('dotenv').config();

const API_KEY = process.env.KMA_API_KEY;

const API_URL =
    'https://apihub.kma.go.kr/api/typ02/openApi/' +
    'VilageFcstInfoService_2.0/getVilageFcst';

async function testKmaForecast() {
    if (!API_KEY) {
        console.error('KMA_API_KEY is missing from .env');
        return;
    }

    // Current Korean local time
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date());

    const get = type =>
        parts.find(p => p.type === type).value;

    const hour = Number(get('hour'));

    // KMA short-term forecast issue hours.
    // Use the previous day's 23:00 issue when necessary.
    const issueHours = [2, 5, 8, 11, 14, 17, 20, 23];

    const eligible = issueHours.filter(h => h <= hour - 2);

    let issueHour;
    let issueDate = new Date(
        Date.UTC(
            Number(get('year')),
            Number(get('month')) - 1,
            Number(get('day'))
        )
    );

    if (eligible.length) {
        issueHour = eligible.at(-1);
    } else {
        issueHour = 23;
        issueDate.setUTCDate(issueDate.getUTCDate() - 1);
    }

    const baseDate = issueDate.toISOString().slice(0, 10)
        .replaceAll('-', '');

    const baseTime = String(issueHour).padStart(2, '0') + '00';

    // Ulsan example grid coordinates; verify for
    // the precise forecast location before production use.
    const nx = 102;
    const ny = 84;

    const url = new URL(API_URL);

    url.searchParams.set('pageNo', '1');
    url.searchParams.set('numOfRows', '1000');
    url.searchParams.set('dataType', 'JSON');
    url.searchParams.set('base_date', baseDate);
    url.searchParams.set('base_time', baseTime);
    url.searchParams.set('nx', String(nx));
    url.searchParams.set('ny', String(ny));
    url.searchParams.set('authKey', API_KEY);

    console.log('Testing KMA short-term forecast API...');
    console.log('Forecast issue:', baseDate, baseTime);
    console.log('Grid:', nx, ny);

    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(20000)
        });

        console.log('HTTP status:', response.status);

        const body = await response.text();
        if (!response.ok) {
    console.log('KMA error response:');
    console.log(body.slice(0, 1000));
    return;
}

        let data;
        try {
            data = JSON.parse(body);
        } catch {
            console.log('Non-JSON response:');
            console.log(body.slice(0, 600));
            return;
        }

        const header = data.response?.header;
        const items = data.response?.body?.items?.item || [];

        console.log('Result code:', header?.resultCode);
        console.log('Result message:', header?.resultMsg);
        console.log('Returned items:', items.length);

        if (items.length > 0) {
            console.log('Sample forecast records:');
            console.log(JSON.stringify(
                items.filter(item =>
                    ['TMP', 'PCP'].includes(item.category)
                ).slice(0, 10),
                null,
                2
            ));
        }
    } catch (error) {
        console.error('Forecast API test failed:', error.message);
    }
}

testKmaForecast();
