
require('dotenv').config();

async function testKwaterLevel() {
    const apiKey = process.env.KWATER_API_KEY;

    if (!apiKey) {
        console.error('KWATER_API_KEY is missing.');
        process.exitCode = 1;
        return;
    }

    const url = new URL(
        'http://apis.data.go.kr/B500001/dam/excllncobsrvt/hourwal/hourwallist'
    );

    // Real station from your K-water response
    const stationCode = '1010640';

    // Get today's date in Korean Standard Time
    const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());

    url.searchParams.set('serviceKey', apiKey);
    url.searchParams.set('_type', 'json');
    url.searchParams.set('damcode', '1012110');
    url.searchParams.set('wal', stationCode);

    url.searchParams.set('sdate', date);
    url.searchParams.set('edate', date);
    url.searchParams.set('stime', '00');
    url.searchParams.set('etime', '23');

    url.searchParams.set('pageNo', '1');
    url.searchParams.set('numOfRows', '100');

    try {
        console.log('Testing K-water hourly water levels...');
        console.log('Station code:', stationCode);
        console.log('Date:', date);

        const response = await fetch(url, {
            signal: AbortSignal.timeout(30000)
        });

        console.log('HTTP status:', response.status);

        const body = await response.text();

        console.log('Response:');
        console.log(body.slice(0, 4000));

        if (!response.ok) {
            throw new Error(
                `K-water HTTP ${response.status}`
            );
        }

        const data = JSON.parse(body);

        const resultCode =
            String(data.response?.header?.resultCode);

        if (resultCode !== '00') {
            throw new Error(
                'K-water API error: ' +
                data.response?.header?.resultMsg
            );
        }

        const items = data.response?.body?.items?.item;

        const records = Array.isArray(items)
            ? items
            : items ? [items] : [];

        console.log('Observation records:', records.length);

        if (records.length === 0) {
            console.log(
                'No observations returned for this station/date.'
            );
        }

    } catch (error) {
        console.error('Test failed:', error.message);
        process.exitCode = 1;
    }
}

testKwaterLevel();
