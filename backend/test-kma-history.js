
require('dotenv').config();

async function testKmaHistory() {
    const requestedTime = '202610251200';

    if (!process.env.KMA_API_KEY) {
        throw new Error('KMA_API_KEY is missing from .env');
    }

    const url = new URL(
        'https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php'
    );

    url.searchParams.set('tm', requestedTime);
    url.searchParams.set('stn', '152');
    url.searchParams.set('help', '1');
    url.searchParams.set('authKey', process.env.KMA_API_KEY);

    const response = await fetch(url, {
        signal: AbortSignal.timeout(30000)
    });

    console.log('HTTP status:', response.status);

    if (!response.ok) {
        throw new Error(`KMA API HTTP error: ${response.status}`);
    }

    const body = await response.text();
    const lines = body.split(/\r?\n/);

    const record = lines.find(line =>
        /^\s*\d{12}\s+152\s/.test(line)
    );

    if (!record) {
        console.log('No historical record found.');
        console.log(body.slice(0, 500));
        return;
    }

    const columns = record.trim().split(/\s+/);

    if (columns.length < 19) {
        throw new Error('Incomplete KMA observation record');
    }

    console.log('Requested time:', requestedTime);
    console.log('Observation time:', columns[0]);
    console.log('Station:', columns[1]);

    if (columns[0] !== requestedTime) {
        console.log('WARNING: Returned observation time does not match.');
        return;
    }

    console.log('Temperature:', columns[11]);
    console.log('RN:', columns[15]);
    console.log('RN_DAY:', columns[16]);
    console.log('RN_JUN:', columns[17]);
    console.log('RN_INT:', columns[18]);
    console.log('Total columns:', columns.length);
}

testKmaHistory().catch(error => {
    console.error('Error:', error.message);
    process.exitCode = 1;
});
