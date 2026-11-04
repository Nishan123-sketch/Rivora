
require('dotenv').config();
const iconv = require('iconv-lite');

async function testKmaStations() {
    const url = new URL(
        'https://apihub.kma.go.kr/api/typ01/url/stn_inf.php'
    );

    url.searchParams.set('inf', 'SFC');
    url.searchParams.set('stn', '0');
    url.searchParams.set('help', '1');
    url.searchParams.set('authKey', process.env.KMA_API_KEY);

    try {
        const response = await fetch(url);

        console.log('HTTP status:', response.status);
        console.log(
            'Content-Type:',
            response.headers.get('content-type')
        );

        const buffer = Buffer.from(
            await response.arrayBuffer()
        );

        // KMA station information may use EUC-KR/CP949.
        const body = iconv.decode(buffer, 'cp949');

        if (!response.ok) {
            console.log(body.slice(0, 500));
            return;
        }

        const lines = body.split(/\r?\n/);

        const records = lines.filter(line =>
            /^\s*\d+\s/.test(line)
        );

        console.log('Station records found:', records.length);

        console.log('\nHeader preview:');
        console.log(lines.slice(0, 20).join('\n'));

        console.log('\nFirst 5 station records:');
        records.slice(0, 5).forEach(record => {
            console.log(record);
        });

    } catch (error) {
        console.error('Request failed:', error.message);
    }
}

testKmaStations();
