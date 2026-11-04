import { useEffect, useState } from 'react';
import { request, token } from '../lib/auth';

export default function AlertPreferences({ stations = [] }) {
  const [selected, setSelected] = useState('');
  const [preferences, setPreferences] = useState([]);
  const [capabilities, setCapabilities] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token()) return;
    let alive = true;
    request('/alert-preferences', undefined, 'GET')
      .then(data => {
        if (!alive) return;
        setPreferences(Array.isArray(data.data) ? data.data : []);
        setCapabilities(data.capabilities || null);
      })
      .catch(error => { if (alive) setMessage(error.message); });
    return () => { alive = false; };
  }, []);

  const current = preferences.find(p => String(p.station_id) === selected)
    || { weather_enabled: false, flood_enabled: false };
  function change(key, checked) {
    setPreferences(previous => [
      ...previous.filter(p => String(p.station_id) !== selected),
      { ...current, station_id: Number(selected), [key]: checked }
    ]);
  }
  async function save(event) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await request('/alert-preferences', {
        station_id: Number(selected),
        weather_enabled: Boolean(current.weather_enabled),
        flood_enabled: Boolean(current.flood_enabled)
      }, 'PUT');
      setMessage(result.message);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <section className="card tall">
    <h3>Email alert preferences</h3>
    {!token() ? <p className="notice">Sign in and verify your email address to save preferences.</p> :
      <form onSubmit={save}>
        <label>Monitoring station
          <select required value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Choose a station</option>
            {stations.map(s => <option key={s.station_id} value={s.station_id}>{s.station_name}</option>)}
          </select>
        </label>
        <label className="preferences-row">
          <input type="checkbox" checked={Boolean(current.flood_enabled)} disabled={!selected}
            onChange={e => change('flood_enabled', e.target.checked)}/>
          Project flood-stage advisory emails (only when verified thresholds and delivery are enabled)
        </label>
        <label className="preferences-row">
          <input type="checkbox" checked={Boolean(current.weather_enabled)} disabled={!selected}
            onChange={e => change('weather_enabled', e.target.checked)}/>
          Save my preference for future weather email alerts (generation not implemented)
        </label>
        <button type="submit" disabled={!selected || busy}>{busy ? 'Saving…' : 'Save preferences'}</button>
      </form>}
    <p role="status">{message}</p>
    <p className="notice">
      Automatic project flood advisories: {capabilities?.automatic_generation_enabled ? 'configured on' : 'disabled'}.
      {' '}Email sending: {capabilities?.email_delivery_enabled ? 'configured on' : 'disabled'}.
      {' '}Weather alert generation: not implemented. No official warning feed is connected.
      Saving preferences does not guarantee an advisory or email.
    </p>
  </section>;
}
