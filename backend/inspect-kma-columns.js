
require('dotenv').config();

async function inspectKmaColumns() {
    const url = new URL(
        'https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php'
    );

    url.searchParams.set('stn', '152');
    url.searchParams.set('help', '1');
    url.searchParams.set('authKey', process.env.KMA_API_KEY);

    const response = await fetch(url, {
        signal: AbortSignal.timeout(30000)
    });

    console.log('HTTP status:', response.status);

    const body = await response.text();

    if (!response.ok) {
        console.log(body.slice(0, 500));
        return;
    }

    const lines = body.split(/\r?\n/);

    console.log('\n--- KMA HEADER / COLUMN DEFINITIONS ---');

    for (const line of lines) {
        if (
            line.includes('RN') ||
            line.includes('TA') ||
            line.includes('YYMMDDHHMI')
        ) {
            console.log(line);
        }
    }

    const record = lines.find(line =>
        /^\s*\d{12}\s+152\s/.test(line)
    );

    if (!record) {
        console.log('\nNo Ulsan observation found.');
        console.log(body.slice(0, 1000));
        return;
    }

    const columns = record.trim().split(/\s+/);

    console.log('\n--- ACTUAL OBSERVATION COLUMNS ---');

    columns.forEach((value, index) => {
        console.log(`columns[${index}] = ${value}`);
    });
}

inspectKmaColumns().catch(error => {
    console.error('Inspection failed:', error.message);
});
