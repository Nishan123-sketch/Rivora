// Tiny in-process cache with in-flight de-duplication.
// Many browser tabs / 60-second pollers asking for the same "latest readings" now share
// ONE database query instead of each running a heavy scan.
const store = new Map();

async function cached(key, ttlMs, loader) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.value !== undefined && now - hit.at < ttlMs) return hit.value;
  if (hit && hit.promise) return hit.promise;           // someone is already loading it
  const promise = Promise.resolve().then(loader).then(
    (value) => { store.set(key, { value, at: Date.now() }); return value; },
    (error) => {
      // On failure keep serving the last good value (if any) rather than an error.
      if (hit && hit.value !== undefined) { store.set(key, hit); return hit.value; }
      store.delete(key);
      throw error;
    }
  );
  store.set(key, { ...(hit || {}), promise });
  return promise;
}

function clearCache(key) { key === undefined ? store.clear() : store.delete(key); }

module.exports = { cached, clearCache };

// Express middleware: cache successful JSON GET responses per URL for ttlMs.
// Used on expensive read-only endpoints that every open browser polls every minute.
function responseCache(ttlMs) {
  const entries = new Map();
  const pending = new Map();
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = req.originalUrl;
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs) {
      res.set('X-Cache', 'HIT');
      return res.status(hit.status).json(hit.body);
    }
    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        entries.set(key, { at: Date.now(), status: 200, body });
        if (entries.size > 500) entries.delete(entries.keys().next().value);
      }
      return origJson(body);
    };
    next();
  };
}
module.exports.responseCache = responseCache;
