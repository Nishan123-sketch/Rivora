import { useEffect, useRef, useState } from 'react';
import '../styles/assistant.css';

const STORAGE_KEY = 'weather-flood-chat';
const SUGGESTIONS = [
  'What does our Weather and Flood Risk Forecasting system do?',
  'Show the latest water level at Taehwa Bridge.',
  'How many verified WAMIS gauges are monitored?',
  'Explain the difference between a river-level forecast and a flood warning.'
];

function storedMessages() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved
      .filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
      .slice(-18) : [];
  } catch { return []; }
}

function inlineText(value) {
  // Render common emphasis without HTML injection or additional libraries.
  return String(value).split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((fragment, i) => {
    if (fragment.startsWith('**') && fragment.endsWith('**')) return <strong key={i}>{fragment.slice(2, -2)}</strong>;
    if (fragment.startsWith('`') && fragment.endsWith('`')) return <code key={i}>{fragment.slice(1, -1)}</code>;
    return fragment;
  });
}

function FormattedAnswer({ text }) {
  // Markdown is rendered as React text, never as dangerouslySetInnerHTML.
  const lines = String(text).split('\n');
  const blocks = [];
  let list = [];
  let paragraph = [];
  let codeLines = null;
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(<p key={`p${blocks.length}`}>{paragraph.map((line, i) => <span key={i}>{i > 0 && <><br /></>}{inlineText(line)}</span>)}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) { blocks.push(<ul key={`l${blocks.length}`}>{list.map((item, i) => <li key={i}>{inlineText(item)}</li>)}</ul>); list = []; }
  };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph(); flushList();
      if (codeLines === null) codeLines = [];
      else { blocks.push(<pre key={`c${blocks.length}`}><code>{codeLines.join('\n')}</code></pre>); codeLines = null; }
      continue;
    }
    if (codeLines !== null) { codeLines.push(line); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push(<h4 key={`h${blocks.length}`}>{inlineText(heading[1])}</h4>);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) { flushParagraph(); list.push(bullet[1]); continue; }
    flushList(); paragraph.push(line.trim());
  }
  flushParagraph(); flushList();
  if (codeLines !== null) blocks.push(<pre key={`c${blocks.length}`}><code>{codeLines.join('\n')}</code></pre>);
  return <div className="assistant-formatted">{blocks}</div>;
}

const emptyStatus = { loading: true, conversational_model_ready: false, mode: 'MONITORING_DATA_ONLY' };

export default function AIAssistant({ stations = [] }) {
  const [messages, setMessages] = useState(storedMessages);
  const [question, setQuestion] = useState('');
  const [stationId, setStationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [providerStatus, setProviderStatus] = useState(emptyStatus);
  const controllerRef = useRef(null);
  const endRef = useRef(null);
  const messagesRef = useRef(messages);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-18))); }
    catch { /* Session storage can be disabled. */ }
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [messages]);
  useEffect(() => {
    let active = true;
    fetch('/api/chat/status')
      .then(r => { if (!r.ok) throw new Error('Backend unavailable'); return r.json(); })
      .then(data => { if (active) setProviderStatus({ ...data, loading: false }); })
      .catch(() => { if (active) setProviderStatus({ ...emptyStatus, loading: false, reason: 'BACKEND_UNAVAILABLE' }); });
    return () => { active = false; controllerRef.current?.abort(); };
  }, []);

  async function send(raw) {
    const text = String(raw || '').trim();
    if (busy || !text) return;
    const recent = messagesRef.current.filter(m => m.content.trim()).slice(-18);
    const conversation = [...recent, { role: 'user', content: text }].slice(-19);
    const pending = { role: 'assistant', content: '', mode: null, retrieved_at: null, station_ids: [] };
    const controller = new AbortController();
    controllerRef.current = controller;
    setMessages([...conversation, pending]);
    setQuestion(''); setError(''); setBusy(true);
    let content = '';
    let metadata = {};
    let ended = false;
    const update = () => setMessages([...conversation, { ...pending, ...metadata, content }]);
    const handleEvent = block => {
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataLine = block.split(/\r?\n/).find(line => line.startsWith('data:'));
      if (!event || !dataLine) return;
      let data;
      try { data = JSON.parse(dataLine.slice(5).trim()); } catch { return; }
      if (event === 'meta') { metadata = data; update(); }
      if (event === 'token') { content += String(data.text || ''); update(); }
      if (event === 'error') throw new Error(data.message || 'The response ended unexpectedly.');
      if (event === 'done') ended = true;
    };
    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation.map(({ role, content }) => ({ role, content })),
          ...(stationId ? { station_id: stationId } : {}) }), signal: controller.signal
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || `Assistant HTTP ${response.status}`);
      }
      if (!response.body) throw new Error('Your browser did not receive a streaming response.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const block of parts) handleEvent(block);
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleEvent(buffer);
      if (!ended) throw new Error('The assistant connection ended before completing the answer.');
      if (!content.trim()) throw new Error('The assistant returned an empty answer.');
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
      if (!content.trim()) {
        // Do not display a permanent empty assistant bubble after a failed request.
        setMessages(conversation);
      }
    } finally { setBusy(false); controllerRef.current = null; }
  }

  function stop() { controllerRef.current?.abort(); setBusy(false); }
  function clear() { controllerRef.current?.abort(); setBusy(false); setMessages([]); setError(''); }

  const modelReady = providerStatus.conversational_model_ready;
  const modeText = providerStatus.loading ? 'Checking assistant model…'
    : modelReady ? `Connected: ${providerStatus.provider} · ${providerStatus.model}`
      : providerStatus.reason === 'BACKEND_UNAVAILABLE' ? 'Backend unavailable'
        : 'Data-only mode · connect Ollama for natural conversations';

  return <section className="assistant-shell card" aria-label="Weather and Flood Risk Forecasting assistant">
    <div className="assistant-header">
      <div><div className="assistant-title"><span className="assistant-avatar" aria-hidden="true">✦</span><div><h3>Weather & Flood Assistant</h3><p className="muted">Ask about your system, weather, rivers, observations and experimental forecasts</p></div></div>
        <p className="assistant-mode" aria-live="polite"><span className={modelReady ? 'assistant-dot on' : 'assistant-dot'} />{modeText}</p>
      </div>
      <button className="assistant-clear" type="button" disabled={busy && !controllerRef.current} onClick={clear}>Clear chat</button>
    </div>
    <div className="assistant-station-filter">
      <label htmlFor="assistant-station">Monitoring station (optional)</label>
      <select id="assistant-station" value={stationId} onChange={e => setStationId(e.target.value)}>
        <option value="">Find station from my question</option>
        {stations.map(s => <option key={s.station_id} value={String(s.station_id)}>{s.station_name} · {s.data_source}</option>)}
      </select>
    </div>
    <div className="assistant-conversation" role="log" aria-label="Chat history" aria-live="off">
      {messages.length === 0 && <div className="assistant-welcome">
        <span aria-hidden="true">✦</span><h3>How can I help with your monitoring system?</h3>
        <p>I can explain the project, inspect stored weather or river readings, and help you understand experimental forecasts and their limitations.</p>
        <div className="assistant-suggestions">{SUGGESTIONS.map(q => <button key={q} onClick={() => send(q)} disabled={busy}>{q}</button>)}</div>
      </div>}
      {messages.map((m, i) => <article className={`assistant-message ${m.role}`} key={i}>
        <div className="assistant-message-label">{m.role === 'user' ? 'You' : 'Assistant'}{m.role === 'assistant' && m.mode === 'MONITORING_DATA_ONLY' && <span className="assistant-data-badge">Data-only</span>}</div>
        {m.content ? <FormattedAnswer text={m.content} /> : <div className="assistant-typing" aria-label="Generating response"><span/><span/><span/></div>}
        {m.role === 'assistant' && m.content && <div className="assistant-message-footer">
          {m.retrieved_at && <span>Data retrieved {new Date(m.retrieved_at).toLocaleString('en-GB', { timeZone: 'Asia/Seoul' })} KST</span>}
          <button type="button" onClick={() => navigator.clipboard?.writeText(m.content)}>Copy</button>
        </div>}
      </article>)}
      <div ref={endRef} />
    </div>
    {error && <p className="assistant-error" role="alert">{error} <button type="button" disabled={busy || !messages.some(m => m.role === 'user')} onClick={() => send([...messages].reverse().find(m => m.role === 'user')?.content)}>Retry</button></p>}
    <form className="assistant-compose" onSubmit={e => { e.preventDefault(); send(question); }}>
      <textarea value={question} maxLength={4000} rows={2} disabled={busy} onChange={e => setQuestion(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(question); } }}
        aria-label="Ask the monitoring assistant" placeholder="Ask a question about the system or a selected location…" />
      {busy ? <button type="button" className="assistant-stop" onClick={stop}>Stop</button>
        : <button type="submit" disabled={!question.trim()}>Send</button>}
    </form>
    <div className="assistant-disclaimer">Educational prototype. AI output is not an official flood warning. Missing or stale observations do not mean an area is safe.</div>
  </section>;
}
