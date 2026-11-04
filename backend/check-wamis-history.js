
const BASE_URL =
  'http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_hrdata';

const STATION_CODE = '2201670';

const periods = [
  {
    name: 'July 2025 flood event',
    start: '20250717',
    end: '20250720'
  },
  {
    name: 'August 2025 heavy rain',
    start: '20250803',
    end: '20250804'
  }
];

async function inspectPeriod(period) {
  const url = new URL(BASE_URL);

  url.searchParams.set('obscd', STATION_CODE);
  url.searchParams.set('startdt', period.start);
  url.searchParams.set('enddt', period.end);
  url.searchParams.set('output', 'json');

  console.log('\nEVENT:', period.name);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000)
    });

    console.log('HTTP status:', response.status);

    const raw = await response.text();

    if (!response.ok) {
      console.log('Server response:', raw.slice(0, 500));
      return;
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      console.log(
        'Non-JSON response:',
        raw.slice(0, 500)
      );
      return;
    }

    console.log('Response structure:');

    console.log(
      JSON.stringify(data, null, 2).slice(0, 3500)
    );

    function findArrays(value, path = 'root', depth = 0) {
      if (!value || depth > 5) return [];

      if (Array.isArray(value)) {
        return [{
          path,
          count: value.length,
          first: value[0] ?? null,
          last: value.at(-1) ?? null
        }];
      }

      if (typeof value !== 'object') {
        return [];
      }

      return Object.entries(value).flatMap(
        ([key, child]) => findArrays(
          child,
          `${path}.${key}`,
          depth + 1
        )
      );
    }

    console.log(
      'Arrays:',
      JSON.stringify(
        findArrays(data),
        null,
        2
      ).slice(0, 3000)
    );

  } catch (error) {
    console.error(
      'Request failed:',
      error.message
    );
  }
}

async function main() {
  for (const period of periods) {
    await inspectPeriod(period);
  }
}

main().catch(console.error);
