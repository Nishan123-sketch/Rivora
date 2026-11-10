
require('dotenv').config();

const iconv = require('iconv-lite');
const pool = require('./db');

async function importKmaStations() {
    const url = new URL(
        'https://apihub.kma.go.kr/api/typ01/url/stn_inf.php'
    );

    url.searchParams.set('inf', 'SFC');
    url.searchParams.set('stn', '0');
    url.searchParams.set('help', '0');
    url.searchParams.set('authKey', process.env.KMA_API_KEY);

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`KMA HTTP ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const body = iconv.decode(buffer, 'cp949');

        const lines = body.split(/\r?\n/);

        let imported = 0;
        let skipped = 0;

        for (const line of lines) {
            // Station data begins with ID, longitude and latitude.
            const match = line.match(
                /^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+/
            );

            if (!match) continue;

            const externalId = match[1];
            const longitude = Number(match[2]);
            const latitude = Number(match[3]);

            if (
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude) ||
                latitude < 33 || latitude > 39.5 ||
                longitude < 124 || longitude > 132
            ) {
                skipped++;
                continue;
            }

            // Extract the station name from the Korean/English name section.
            const nameMatch = line.match(
                /\s([가-힣][가-힣0-9\s·()-]*?)(?=[A-Za-z])/
            );

            if (!nameMatch) {
                skipped++;
                console.log('Could not parse name:', line);
                continue;
            }

            const stationName = nameMatch[1].trim();

            if (!stationName) {
                skipped++;
                continue;
            }

            await pool.query(
                `INSERT INTO stations
                 (station_name, latitude, longitude,
                  data_source, external_station_id,coordinate_source_url)
                 VALUES (?, ?, ?, 'KMA', ?,?)
                 ON DUPLICATE KEY UPDATE
                    station_name = VALUES(station_name),
                    latitude = VALUES(latitude),
                    longitude = VALUES(longitude), coordinate_source_url=VALUES(coordinate_source_url)`,
                [stationName, latitude, longitude, externalId,"https://apihub.kma.go.kr/api/typ01/url/stn_inf.php"]
            );

            imported++;
        }

        console.log('KMA station import completed.');
        console.log('Stations inserted or updated:', imported);
        console.log('Records skipped:', skipped);

    } catch (error) {
        console.error('Import failed:', error.message);
    } finally {
        await pool.end();
    }
}

importKmaStations();
