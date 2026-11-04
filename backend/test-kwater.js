
require('dotenv').config();

async function testKwater() {
    const apiKey = process.env.KWATER_API_KEY;

    if (!apiKey) {
        console.error('KWATER_API_KEY is missing from .env');
        process.exitCode = 1;
        return;
    }

    // Official K-water water-level station code endpoint
    const url = new URL(
        'http://apis.data.go.kr/B500001/dam/excllncobsrvt/wal/wallist'
    );

   url.searchParams.set('serviceKey', apiKey);
url.searchParams.set('_type', 'json');
url.searchParams.set('damcode', '1012110');

    try {
        console.log('Connecting to K-water API...');

        const response = await fetch(url, {
            signal: AbortSignal.timeout(30000)
        });

        console.log('HTTP status:', response.status);

        const body = await response.text();

        console.log('Response length:', body.length);
        console.log('Response preview:');
        console.log(body.slice(0, 2000));

        if (!response.ok) {
            throw new Error(
                `K-water HTTP ${response.status}`
            );
        }

    } catch (error) {
        console.error(
            'K-water connection failed:',
            error.message
        );

        process.exitCode = 1;
    }
}

testKwater();
