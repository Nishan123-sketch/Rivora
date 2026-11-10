// WAMIS publishes station searches, official station metadata, and hourly readings.
// This module never invents gauge IDs or measurements.
const DEFAULT_BASE = 'http://www.wamis.go.kr:8080/wamis/openapi';
const BASE_URL = (process.env.WAMIS_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
let nextRequestAt = 0;
let consecutiveTransientFailures = 0;
let circuitOpenUntil = 0;
let active = Promise.resolve();
async function waitForRateSlot() {
  const start = Math.max(Date.now(), nextRequestAt);
  nextRequestAt = start + 900; // ~1 request/sec to protect the upstream service.
  const delay = start - Date.now();
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
}


async function getWamis(path, params = {}, timeoutMs = 18000) {
  // All WAMIS requests in this process share one lane; batch jobs should not flood the provider.
  const prior = active;
  let release;
  active = new Promise(resolve => { release = resolve; });
  await prior;
  try {
    return await getWamisSerial(path, params, timeoutMs);
  } finally { release(); }
}

async function getWamisSerial(path, params, timeoutMs, maxAttempts = 3) {
  if (Date.now() < circuitOpenUntil) {
    throw new Error('WAMIS temporarily unavailable; requests paused after repeated network failures');
  }
  const url = new URL(`${BASE_URL}/wkw/${path}`);

  for (const [key, value] of Object.entries({
    ...params,
    output: 'json'
  })) {
    url.searchParams.set(key, String(value));
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await waitForRateSlot();

      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: 'application/json',
          Connection: 'close'
        }
      });

      if (!response.ok) {
        const error = new Error(
          `WAMIS ${path}: HTTP ${response.status}`
        );
        error.status = response.status;
        throw error;
      }

      const bytes = await response.arrayBuffer();

      let content = new TextDecoder('utf-8').decode(bytes);

      if (content.includes('�')) {
        content = new TextDecoder('euc-kr').decode(bytes);
      }

      let result;

      try {
        result = JSON.parse(content);
      } catch {
        throw new Error(
          `WAMIS ${path}: invalid JSON response`
        );
      }

      if (
        result?.result?.code !== 'success' ||
        !Array.isArray(result.list)
      ) {
        throw new Error(
          `WAMIS ${path}: ${
            result?.result?.msg || 'Unexpected response'
          }`
        );
      }

      consecutiveTransientFailures = 0;
      return result.list;

    } catch (error) {
      const retryable =
        error.name === 'TimeoutError' ||
        error.name === 'AbortError' ||
        error instanceof TypeError ||
        error.status === 408 ||
        error.status === 429 ||
        error.status >= 500;

      if (!retryable || attempt === maxAttempts) {
        if (retryable) {
          consecutiveTransientFailures += 1;
          if (consecutiveTransientFailures >= 4) {
            circuitOpenUntil = Date.now() + 60000;
            consecutiveTransientFailures = 0;
            console.warn('WAMIS: pausing requests for 60 seconds after repeated transient failures');
          }
        }
        throw error;
      }

      const delay = Math.min(12000, 1500 * (2 ** (attempt - 1)));

      console.warn(
        `WAMIS ${path}: ${error.message}; ` +
        `retry ${attempt}/${maxAttempts - 1}`
      );

      await new Promise(resolve =>
        setTimeout(resolve, delay)
      );
    }
  }
}


function parseCoord(raw, axis) {
  if (raw === null || raw === undefined || raw === '') return null;
  const str = String(raw).trim();
  let result;
  if (/^\d{2,3}-\d{1,2}-\d+(?:\.\d+)?$/.test(str)) {
    const [deg,min,sec] = str.split('-').map(Number);
    // Some official coordinates round seconds to exactly 60; arithmetic carries that into the next minute.
    if (min >= 60 || sec > 60) return null;
    result = deg + min/60 + sec/3600;
  } else if (/^-?\d+(?:\.\d+)?$/.test(str)) result = Number(str);
  else return null;
  if (axis === 'lat') return result >= 33 && result <= 39 ? result : null;
  return result >= 124 && result <= 132 ? result : null;
}

// WAMIS hourly identifiers represent hour ending 01..24 in Korean Standard Time.
function wamisHour(value) {
  const v = String(value || '');
  if (!/^\d{10}$/.test(v)) return null;
  const y=Number(v.slice(0,4)),m=Number(v.slice(4,6)),d=Number(v.slice(6,8)),h=Number(v.slice(8,10));
  if (h<1||h>24) return null;
  const base=new Date(Date.UTC(y,m-1,d));
  if (base.getUTCFullYear()!==y||base.getUTCMonth()!==m-1||base.getUTCDate()!==d) return null;
  return new Date(Date.UTC(y,m-1,d,h)).toISOString().slice(0,19).replace('T',' ');
}
function levelOrNull(raw) {
  if (raw===null||raw===undefined||String(raw).trim()==='') return null;
  const n=Number(raw); return Number.isFinite(n) && n>-50 ? n : null;
}
function koreanDate(daysAgo = 0) {
  const d = new Date(Date.now() + 9 * 3600000 - daysAgo * 86400000);
  return d.toISOString().slice(0,10).replaceAll('-','');
}
function normalizeStationInfo(record) {
  if (!record || typeof record !== 'object') return null;
  const code=String(record.wlobscd || record.obscd || '').trim();
  const riverName=String(record.rivnm || '').trim();
  const stationName=String(record.obsnm || record.obsnmeng || '').trim();
  const lat=parseCoord(record.lat,'lat'),lon=parseCoord(record.lon,'lon');
  if (!/^\d{5,12}$/.test(code) || !riverName || !stationName || lat===null || lon===null) return null;
  return {code,riverName,stationName,lat,lon};
}
function mapReadings(items) {
  return items.map(x=>({observedAt:wamisHour(x.ymdh),waterLevel:levelOrNull(x.wl)}))
    .filter(x=>x.observedAt && x.waterLevel !== null);
}
// Only the bounded two-worker historical collector uses this entry point.
// Both workers still reserve the shared ~1-request/second rate slots.
module.exports = { getWamis, getWamisForHistory:(path,params,timeoutMs)=>getWamisSerial(path,params,timeoutMs,1), parseCoord, wamisHour, levelOrNull, koreanDate, normalizeStationInfo, mapReadings, BASE_URL };

