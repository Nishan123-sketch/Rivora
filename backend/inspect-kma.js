
require('dotenv').config();

async function inspectKma() {
  const url = new URL(
    'https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php'
  );

  url.searchParams.set('stn', '0');
  url.searchParams.set('help', '0');
  url.searchParams.set('authKey', process.env.KMA_API_KEY);

  try {
    const response = await fetch(url);
    const body = await response.text();

    if (!response.ok) {
      console.error('KMA request failed:', response.status);
      console.error(body.slice(0, 300));
      return;
    }

    const lines = body.split(/\r?\n/);

    const records = lines
      .map(line => line.trim())
      .filter(line => /^\d{12}\s+\d+\s/.test(line));

    console.log('Observation records:', records.length);

    for (const record of records.slice(0, 5)) {
      const columns = record.split(/\s+/);

      const validNumber = value => {
        const number = Number(value);
        return Number.isFinite(number) && number > -9
          ? number
          : null;
      };

      
console.log({
  observedAtKST: columns[0],
  kmaStationId: columns[1],
  temperatureC: validNumber(columns[11]),

  rainfallFields: {
    rn: columns[15],
    rnDay: columns[16],
    rnJun: columns[17],
    rnInt: columns[18]
  }
});

    }
  } catch (error) {
    console.error('Request error:', error.message);
  }
}

inspectKma();
