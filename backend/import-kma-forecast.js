
require('dotenv').config();

const pool = require('./db');
const { findUlsanKma } = require('./station-defaults');

const API_URL =
  'https://apihub.kma.go.kr/api/typ02/openApi/' +
  'VilageFcstInfoService_2.0/getVilageFcst';

const { toKmaGrid } = require('./kma-grid');
const SOURCE = 'KMA_VILAGE_FCST';

function getLatestIssue() {
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
  const issueHours = [2, 5, 8, 11, 14, 17, 20, 23];
  const eligible = issueHours.filter(h => h <= hour - 2);

  const date = new Date(Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day'))
  ));

  let issueHour;

  if (eligible.length) {
    issueHour = eligible.at(-1);
  } else {
    issueHour = 23;
    date.setUTCDate(date.getUTCDate() - 1);
  }

  return {
    baseDate: date.toISOString()
      .slice(0, 10)
      .replaceAll('-', ''),
    baseTime: String(issueHour).padStart(2, '0') + '00'
  };
}

function toSqlDate(date, time) {
  return (
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ` +
    `${time.slice(0, 2)}:${time.slice(2, 4)}:00`
  );
}

function parsePrecipitation(value) {
  const raw = value === undefined || value === null ? null : String(value).trim();
  if (!raw) return { raw, exact: null, min: null, max: null, maxExclusive: false };
  if (raw === '강수없음') return { raw, exact: 0, min: 0, max: 0, maxExclusive: false };
  const exact = raw.match(/^(\d+(?:\.\d+)?)\s*(?:mm)?$/i);
  if (exact) {
    const n = Number(exact[1]);
    return { raw, exact: n, min: n, max: n, maxExclusive: false };
  }
  // KMA's "1mm 미만" means 0 <= rainfall < 1 mm.
  const under = raw.match(/^(\d+(?:\.\d+)?)\s*mm\s*미만$/i);
  if (under) return { raw, exact: null, min: 0, max: Number(under[1]), maxExclusive: true };
  // Preserve numeric ranges without substituting their midpoint.
  const range = raw.match(/^(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)\s*mm$/i);
  if (range && Number(range[1]) <= Number(range[2])) {
    return { raw, exact: null, min: Number(range[1]), max: Number(range[2]), maxExclusive: false };
  }
  return { raw, exact: null, min: null, max: null, maxExclusive: false };
}

async function importKmaForecast(requestedStationId = null) {
  const key = process.env.KMA_API_KEY;

  if (!key) throw Object.assign(new Error('KMA_API_KEY missing'),{code:'KMA_KEY_MISSING'});

  // Default to Ulsan; optional database station ID supports other KMA stations.
  const defaultStation = requestedStationId === null ? await findUlsanKma() : null;
  const stationId = requestedStationId === null ? Number(defaultStation?.station_id) : Number(requestedStationId);
  if (!Number.isSafeInteger(stationId) || stationId < 1) throw new Error('Valid KMA station ID required');
  const [rows] = await pool.execute(
    "SELECT station_id, station_name, latitude, longitude FROM stations WHERE station_id = ? AND data_source = 'KMA' LIMIT 1",
    [stationId]
  );
  if (!rows.length) throw new Error(`KMA station ${stationId} not found`);
  const { nx, ny } = toKmaGrid(Number(rows[0].latitude), Number(rows[0].longitude));

  const { baseDate, baseTime } = getLatestIssue();

  const url = new URL(API_URL);

  const params = {
    authKey: key,
    pageNo: '1',
    numOfRows: '1000',
    dataType: 'JSON',
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny)
  };

  Object.entries(params).forEach(([name, value]) =>
    url.searchParams.set(name, value)
  );

  console.log('Fetching KMA forecasts:', rows[0].station_name, stationId, nx, ny, baseDate, baseTime);

 
  const items = [];
  const pageSize = 1000;
  let pageNo = 1;
  let totalCount = null;

  while (true) {
    url.searchParams.set('pageNo', String(pageNo));
    url.searchParams.set('numOfRows', String(pageSize));

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) throw Object.assign(new Error(`KMA forecast HTTP ${response.status}, page ${pageNo}`),{code:'KMA_HTTP_ERROR'});
    let data;try{data=await response.json();}catch{throw Object.assign(new Error('KMA forecast response was not valid JSON'),{code:'KMA_RESPONSE_ERROR',publicMessage:'the service returned an unreadable response'});}

    if (data.response?.header?.resultCode !== '00') {
      const resultMsg=String(data.response?.header?.resultMsg||'KMA forecast API error').slice(0,180);
      throw Object.assign(new Error(resultMsg),{code:'KMA_RESPONSE_ERROR',publicMessage:resultMsg});
    }

    const body = data.response?.body;
    const pageItems = body?.items?.item || [];

    if (!Array.isArray(pageItems)) {
      throw new Error('Invalid KMA forecast items');
    }

    const reportedTotal = Number(body?.totalCount);

    if (!Number.isSafeInteger(reportedTotal) ||
        reportedTotal < 0) {
      throw new Error('Invalid KMA forecast totalCount');
    }

    if (totalCount === null) totalCount = reportedTotal;

    items.push(...pageItems);

    console.log(
      `KMA forecast page ${pageNo}: ` +
      `${items.length}/${totalCount} records`
    );

    if (items.length >= totalCount) break;

    if (pageItems.length === 0) {
      throw new Error('KMA pagination stopped before completion');
    }

    pageNo++;

    if (pageNo > 30) {
      throw new Error('KMA pagination exceeded safety limit');
    }
  }

  if (items.length !== totalCount) {
    throw new Error('KMA forecast record count mismatch');
  }

  const forecasts = new Map();


  for (const item of items) {
    if (!['TMP', 'PCP', 'POP', 'REH', 'WSD'].includes(item.category)) continue;

    const validAt = toSqlDate(item.fcstDate, item.fcstTime);

    if (!forecasts.has(validAt)) {
      forecasts.set(validAt, {
        temperature: null,
        rainfall: null,
        rainProbability: null, humidity: null, windSpeed: null, precipitation: { raw: null, exact: null, min: null, max: null, maxExclusive: false }
      });
    }

    const forecast = forecasts.get(validAt);

    if (item.category === 'TMP') {
      const temperature = Number(item.fcstValue);

      forecast.temperature =
        Number.isFinite(temperature) ? temperature : null;
    }

    if (item.category === 'POP') forecast.rainProbability = /^\d+(\.\d+)?$/.test(String(item.fcstValue)) ? Number(item.fcstValue) : null;
    if (item.category === 'REH') forecast.humidity = /^\d+(\.\d+)?$/.test(String(item.fcstValue)) ? Number(item.fcstValue) : null;
    if (item.category === 'WSD') forecast.windSpeed = /^\d+(\.\d+)?$/.test(String(item.fcstValue)) ? Number(item.fcstValue) : null;
    if (item.category === 'PCP') {
      forecast.precipitation = parsePrecipitation(item.fcstValue);
      forecast.rainfall = forecast.precipitation.exact;
    }
  }

  if(!forecasts.size)throw Object.assign(new Error('KMA returned no supported forecast categories'),{code:'KMA_EMPTY_FORECAST'});

  const issuedAt = toSqlDate(baseDate, baseTime);

  let inserted = 0;
  let updated = 0;

  let connection;try{connection=await pool.getConnection();}catch(error){throw Object.assign(error,{code:'KMA_DATABASE_ERROR',detailCode:error.code});}

  try {
    await connection.beginTransaction();

    for (const [validAt, forecast] of forecasts) {
      const [existing] = await connection.execute(
        `SELECT forecast_id
         FROM weather_forecasts
         WHERE station_id = ?
           AND issued_at = ?
           AND valid_at = ?
           AND source = ?
         LIMIT 1`,
        [stationId, issuedAt, validAt, SOURCE]
      );

      if (existing.length) {
        await connection.execute(
          `UPDATE weather_forecasts
           SET rainfall_forecast = ?,
               temperature_forecast = ?,
               precipitation_probability = ?, humidity_forecast = ?, wind_speed_forecast = ?,
               precipitation_raw = ?, precipitation_min_mm = ?, precipitation_max_mm = ?, precipitation_max_exclusive = ?
           WHERE forecast_id = ?`,
          [
            forecast.rainfall,
            forecast.temperature, forecast.rainProbability, forecast.humidity, forecast.windSpeed,
            forecast.precipitation.raw, forecast.precipitation.min, forecast.precipitation.max,
            forecast.precipitation.maxExclusive ? 1 : 0, existing[0].forecast_id
          ]
        );
        updated++;
      } else {
        await connection.execute(
          `INSERT INTO weather_forecasts
           (station_id, issued_at, valid_at,
            rainfall_forecast, temperature_forecast, source, precipitation_probability, humidity_forecast, wind_speed_forecast,
            precipitation_raw, precipitation_min_mm, precipitation_max_mm, precipitation_max_exclusive)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            stationId,
            issuedAt,
            validAt,
            forecast.rainfall,
            forecast.temperature,
            SOURCE, forecast.rainProbability, forecast.humidity, forecast.windSpeed,
            forecast.precipitation.raw, forecast.precipitation.min, forecast.precipitation.max,
            forecast.precipitation.maxExclusive ? 1 : 0
          ]
        );
        inserted++;
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw Object.assign(error,{code:'KMA_DATABASE_ERROR',detailCode:error.code});
  } finally {
    connection.release();
  }

  console.log('Forecast issue:', issuedAt);
  console.log('API items:', items.length);
  console.log('Forecast hours:', forecasts.size);
  console.log('Inserted:', inserted);
  console.log('Updated:', updated);
  console.log('Import complete.');
  return {issued_at:issuedAt,record_count:forecasts.size,inserted,updated};
}

// Run the importer only when executed directly.
if (require.main === module) {
  importKmaForecast(process.argv[2] ?? null)
    .catch(error => {
      console.error('Import failed:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

// Allow the scheduler to call the importer.
module.exports = { importKmaForecast };
