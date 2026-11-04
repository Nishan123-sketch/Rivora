
require('dotenv').config();

async function checkKmaRainfall() {
    if (!process.env.KMA_API_KEY) {
        throw new Error('KMA_API_KEY is missing');
    }

    const url = new URL(
        'https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php'
    );

    url.searchParams.set('stn', '152');
    url.searchParams.set('help', '1');
    url.searchParams.set('authKey', process.env.KMA_API_KEY);

    const response = await fetch(url, {
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error(`KMA HTTP ${response.status}`);
    }

    const body = await response.text();
    const lines = body.split(/\r?\n/);

    console.log('\nKMA response header:');
    console.log(
    lines.filter(line => line.trim().startsWith('#'))
        .join('\n')
);

    const record = lines.find(line =>
        /^\s*\d{12}\s+152\s/.test(line)
    );

    if (!record) {
        console.log('No Ulsan station record found.');
        return;
    }

    console.log('\nUlsan observation columns:');

    record.trim().split(/\s+/).forEach((value, index) => {
        console.log(`Column ${index}: ${value}`);
    });
}

checkKmaRainfall().catch(error => {
    console.error('Error:', error.message);
    process.exitCode = 1;
});
