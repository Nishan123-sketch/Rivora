// Usage (from the backend folder):  npm run diagnose
// Tells you exactly why the dashboard says "cannot reach the server".
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const net = require('net');

const port = Number(process.env.PORT) || 5000;
const ok = (m) => console.log('  [OK]   ' + m);
const bad = (m) => { console.log('  [FAIL] ' + m); failures++; };
let failures = 0;

function portInUse(p, host) {
  return new Promise((resolve) => {
    const s = net.connect({ port: p, host, timeout: 2000 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve('timeout'); });
    s.once('error', () => resolve(false));
  });
}

(async () => {
  console.log('1) backend/.env');
  if (!fs.existsSync(path.join(__dirname, '.env'))) bad('backend/.env is missing. Copy .env.example to .env and set DB_USER / DB_PASSWORD / DB_NAME.');
  else {
    ok('.env found');
    for (const k of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) if (!process.env[k]) bad(`${k} is empty in .env`);
  }

  console.log('2) MySQL');
  let pool;
  try {
    pool = require('./db');
    const t0 = Date.now();
    const [[r]] = await pool.query('SELECT DATABASE() AS db');
    ok(`connected to database "${r.db}" in ${Date.now() - t0} ms`);
    for (const t of ['stations', 'weather_readings', 'water_readings']) {
      try {
        const t1 = Date.now();
        const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM ${t}`);
        ok(`${t}: ${c.n} rows (${Date.now() - t1} ms)`);
      } catch (e) { bad(`${t}: ${e.code || e.message}  -> run: npm run migrate`); }
    }
    // the exact queries the dashboard calls, timed
    const data = require('./data-routes');
    ok('data-routes loaded (' + (data.stack ? data.stack.length : '?') + ' routes)');
  } catch (e) {
    bad(`cannot use MySQL: ${e.code || ''} ${e.message}\n         -> Is MySQL running (Windows: services.msc -> MySQL80)? Are DB_HOST/DB_PORT/DB_USER/DB_PASSWORD right?`);
  }

  console.log(`3) Backend on port ${port}`);
  const inUse = await portInUse(port, '127.0.0.1');
  if (!inUse) bad(`nothing is listening on 127.0.0.1:${port}. The backend is NOT running (or crashed). Start it: npm run dev  and read its console for errors.`);
  else {
    ok(`something is listening on port ${port}`);
    for (const p of ['/api/health', '/api/stations', '/api/weather/latest', '/api/water/latest']) {
      const t = Date.now();
      try {
        const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(20000) });
        const body = await r.text();
        (r.ok ? ok : bad)(`${p} -> HTTP ${r.status} in ${Date.now() - t} ms ${r.ok ? '' : body.slice(0, 160)}`);
        if (r.ok && !/^\/api\/health/.test(p)) { try { const j = JSON.parse(body); if (j.success !== true) bad(`${p}: unexpected JSON shape - is this really this project's backend on port ${port}?`); } catch { bad(`${p}: response is not JSON - another program may be using port ${port}`); } }
      } catch (e) { bad(`${p} -> ${e.name === 'TimeoutError' ? 'NO ANSWER within 20 s (backend or DB is hanging)' : e.message}`); }
    }
  }

  console.log(failures ? `\n${failures} problem(s) found - fix the first [FAIL] above, then run this again.` : '\nAll checks passed. If the browser still fails, restart BOTH servers and hard-refresh (Ctrl+Shift+R).');
  if (pool) await pool.end().catch(() => {});
  process.exitCode = failures ? 1 : 0;
})();
