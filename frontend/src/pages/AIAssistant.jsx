import {monitorConnection,connectionLabel,conversationMessages} from '../lib/assistantConnection';
import {englishStationName} from '../lib/englishDisplay';
import {apiFetch} from '../lib/apiFetch.js';
import { useEffect, useRef, useState } from 'react';
import '../styles/assistant.css';

const STORAGE_KEY = 'weather-flood-chat';
const SUGGESTIONS = [
  'What is the weather in Seoul?',
  'Show the latest water level at Taehwa Bridge.',
  'What is the weather forecast for Busan tomorrow?',
  'Show Taehwa Bridge readings from yesterday.'
];

function storedMessages() {
  try {
    if(sessionStorage.getItem('weather_flood_token'))return [];
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

export default function AIAssistant(props){return <AssistantConversation key={props.user?.user_id||sessionStorage.getItem('weather_flood_token')||'guest'} {...props}/>;}

function AssistantConversation({ stations = [], user = null }) {
  const [messages, setMessages] = useState(()=>user?[]:storedMessages());
  const [savedChats,setSavedChats]=useState([]);
  const [chatId,setChatId]=useState('');
  const [historyError,setHistoryError]=useState('');
  const [question, setQuestion] = useState('');
  const [stationId, setStationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [providerStatus, setProviderStatus] = useState(emptyStatus);
  const controllerRef = useRef(null);
  const sendingRef=useRef(false);
  const [connectionRevision,setConnectionRevision]=useState(0);
  const endRef = useRef(null);
  const messagesRef = useRef(messages);

  useEffect(() => { messagesRef.current = messages; }, [messages,user]);
  useEffect(() => {
    try { if(user||sessionStorage.getItem('weather_flood_token'))sessionStorage.removeItem(STORAGE_KEY);else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-18))); }
    catch { /* Session storage can be disabled. */ }
    const conversation = endRef.current?.parentElement;
    conversation?.scrollTo({top:conversation.scrollHeight,behavior:'smooth'});
  }, [messages,user]);
  useEffect(() => {
    const monitor=monitorConnection({fetcher:apiFetch,onState:setProviderStatus});
    const resume=()=>monitor.resume();document.addEventListener('visibilitychange',resume);
    return()=>{monitor.dispose();document.removeEventListener('visibilitychange',resume);};
  }, [connectionRevision]);

  useEffect(()=>()=>controllerRef.current?.abort(),[]);
  const token=sessionStorage.getItem('weather_flood_token'),authenticated=Boolean(user||token);
  const authHeaders=()=>({'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})});
  async function refreshChats(){if(!authenticated)return;const r=await apiFetch('/api/chat/conversations',{headers:authHeaders()});if(!r.ok)throw Error('Saved conversations unavailable');setSavedChats((await r.json()).conversations||[]);}
  async function newChat(){clear();setChatId('');if(!authenticated)return;try{const r=await apiFetch('/api/chat/conversations',{method:'POST',headers:authHeaders(),body:JSON.stringify({title:'New conversation'})});if(!r.ok)throw Error('Could not create conversation');setChatId((await r.json()).conversation_id);await refreshChats();}catch(e){setHistoryError(e.message);}}
  async function openChat(id){if(busy)return;try{const r=await apiFetch(`/api/chat/conversations/${id}`,{headers:authHeaders()});if(!r.ok)throw Error('Could not load conversation');setMessages((await r.json()).messages||[]);setChatId(id);setError('');}catch(e){setHistoryError(e.message);}}
  async function manageChat(action){if(!chatId)return;let title;if(action==='rename'){title=window.prompt('Conversation title');if(!title?.trim())return;}try{const r=await apiFetch(`/api/chat/conversations/${chatId}`,{method:action==='rename'?'PATCH':'DELETE',headers:authHeaders(),...(title?{body:JSON.stringify({title})}:{})});if(!r.ok)throw Error('Could not update conversation');if(action==='delete'){clear();setChatId('');}await refreshChats();}catch(e){setHistoryError(e.message);}}
  useEffect(()=>{if(!authenticated)return;let active=true;apiFetch('/api/chat/conversations',{headers:token?{Authorization:`Bearer ${token}`}:{}}).then(r=>{if(!r.ok)throw Error('Saved conversations unavailable');return r.json();}).then(d=>{if(active)setSavedChats(d.conversations||[]);}).catch(e=>{if(active)setHistoryError(e.message);});return()=>{active=false;};},[token,authenticated]);

  async function send(raw) {
    const text = String(raw || '').trim();
    if (sendingRef.current || !text) return;
    sendingRef.current=true;
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
    const update = () => {if(controllerRef.current===controller&&!controller.signal.aborted)setMessages([...conversation, { ...pending, ...metadata, content }]);};
    const handleEvent = block => {
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataLine = block.split(/\r?\n/).find(line => line.startsWith('data:'));
      if (!event || !dataLine) return;
      let data;
      try { data = JSON.parse(dataLine.slice(5).trim()); } catch { return; }
      if (event === 'meta') { metadata = data; if(data.mode==='CONVERSATION_FALLBACK')setProviderStatus(s=>({...s,loading:false,conversational_model_ready:false,reason:'MODEL_STARTING'}));else if(data.mode==='LANGUAGE_MODEL')setProviderStatus(s=>({...s,loading:false,conversational_model_ready:true,reason:null})); update(); }
      if (event === 'token') { content += String(data.text || ''); update(); }
      if (event === 'error') {const e=new Error(data.message||'The response ended unexpectedly.');e.code=data.code;e.retryable=data.retryable;throw e;}
      if (event === 'done') ended = true;
    };
    try {
      const response = await apiFetch('/api/chat/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token?{Authorization:`Bearer ${token}`}:{}) },
        body: JSON.stringify({ messages: conversationMessages(conversation),
          ...(stationId ? { station_id: stationId } : {}) }), signal: AbortSignal.any([controller.signal,AbortSignal.timeout(70000)])
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
      if(authenticated&&chatId){const saved=await apiFetch(`/api/chat/conversations/${chatId}/messages`,{method:'POST',headers:authHeaders(),body:JSON.stringify({messages:[{role:'user',content:text},{role:'assistant',content}]})});if(!saved.ok)setHistoryError('Answer received, but could not save this exchange.');else await refreshChats();}
    } catch (err) {
      if(controllerRef.current!==controller)return;
      if(err.name!=='AbortError')setError(err.name==='TimeoutError'?'The assistant took too long to answer. Please retry.':err.message);
      if (!content.trim()) {
        // Do not display a permanent empty assistant bubble after a failed request.
        setMessages(conversation);
      }
    } finally {if(controllerRef.current===controller){setBusy(false);controllerRef.current=null;sendingRef.current=false;}}
  }

  function retry(){const index=messagesRef.current.findLastIndex(m=>m.role==='user');if(index<0)return;const text=messagesRef.current[index].content;messagesRef.current=messagesRef.current.slice(0,index);setMessages(messagesRef.current);send(text);}

  function stop() { controllerRef.current?.abort();controllerRef.current=null;sendingRef.current=false;setBusy(false); }
  function clear() { controllerRef.current?.abort();controllerRef.current=null;sendingRef.current=false;setBusy(false);setMessages([]);messagesRef.current=[];setError(''); }

  const modelReady = providerStatus.conversational_model_ready;
  const modeText=connectionLabel(providerStatus);

  return <section className="assistant-shell card" aria-label="Rivora Assist">
    <div className="assistant-header">
      <div><div className="assistant-title"><span className="assistant-avatar" aria-hidden="true">✦</span><div><h3>Rivora Assist</h3><p className="muted">Your conversation, weather, river conditions and history—in one place.</p></div></div>
        <p className="assistant-mode" aria-live="polite"><span className={modelReady ? 'assistant-dot on' : 'assistant-dot'} />{modeText}{!modelReady&&!providerStatus.loading&&<button type="button" className="assistant-clear" disabled={busy} onClick={()=>setConnectionRevision(v=>v+1)}>Retry connection</button>}</p>
      </div>
      <button className="assistant-clear" type="button" disabled={busy && !controllerRef.current} onClick={clear}>Clear chat</button>
    </div>
    <div className="assistant-history-controls">
      <button type="button" disabled={busy} onClick={newChat}>New chat</button>
      {authenticated?<><select aria-label="Saved conversations" disabled={busy} value={chatId} onChange={e=>e.target.value?openChat(e.target.value):newChat()}><option value="">Choose saved conversation (private)</option>{savedChats.map(c=><option key={c.conversation_id} value={c.conversation_id}>{c.title}</option>)}</select><button type="button" disabled={!chatId||busy} onClick={()=>manageChat('rename')}>Rename</button><button type="button" disabled={!chatId||busy} onClick={()=>manageChat('delete')}>Delete</button></>:<span>Sign in to save private conversations. Guest chats stay in this browser session.</span>}
      <details className="assistant-privacy"><summary>Privacy & storage</summary><span>Saving is optional: choose New chat to start saved history. Messages go to the configured language provider; factual tools read monitoring data only. Deleted chats await cleanup for 30 days; inactive chats expire after 90 days when maintenance runs.</span></details>{historyError&&<span role="status">{historyError}</span>}
    </div>
    <div className="assistant-station-filter">
      <label htmlFor="assistant-station">Monitoring station (optional)</label>
      <select id="assistant-station" value={stationId} onChange={e => setStationId(e.target.value)}>
        <option value="">Find station from my question</option>
        {stations.map(s => <option key={s.station_id} value={String(s.station_id)}>{englishStationName(s.station_name,s.external_station_id)}</option>)}
      </select>
    </div>
    <div className="assistant-conversation" role="log" aria-label="Chat history" aria-live="off">
      {messages.length === 0 && <div className="assistant-welcome">
        <span aria-hidden="true">✦</span><h3>How can I help you today?</h3>
        <p>Ask a question, explore a location, or check the latest conditions.</p>
        <div className="assistant-suggestions">{SUGGESTIONS.map(q => <button key={q} onClick={() => send(q)} disabled={busy}>{q}</button>)}</div>
      </div>}
      {messages.map((m, i) => <article className={`assistant-message ${m.role}`} key={i}>
        <div className="assistant-message-label">{m.role === 'user' ? 'You' : 'Rivora Assist'}{m.role === 'assistant' && m.mode === 'MONITORING_DATA_ONLY' && <span className="assistant-data-badge">Data-only</span>}</div>
        {m.content ? <FormattedAnswer text={m.content} /> : <div className="assistant-typing" aria-label="Generating response"><span/><span/><span/></div>}
        {m.role==='assistant'&&m.evidence?.length>0&&<details className="assistant-evidence"><summary>Evidence · {m.evidence.length} records</summary>{m.evidence.slice(0,24).map((e,j)=><p key={j}>{e.station_name} · {e.metric} · {e.value??'unavailable'} {e.unit} · {e.observed_at||e.valid_at} · {e.source} · {e.freshness}</p>)}</details>}
        {m.role === 'assistant' && m.content && <div className="assistant-message-footer">
          {m.retrieved_at && <span>Data retrieved {new Date(m.retrieved_at).toLocaleString('en-GB', { timeZone: 'Asia/Seoul' })} KST</span>}
          <button type="button" onClick={() => navigator.clipboard?.writeText(m.content)}>Copy</button>
        </div>}
      </article>)}
      <div ref={endRef} />
    </div>
    {error && <p className="assistant-error" role="alert">{error} <button type="button" disabled={busy || !messages.some(m => m.role === 'user')} onClick={retry}>Retry</button></p>}
    <form className="assistant-compose" onSubmit={e => { e.preventDefault(); send(question); }}>
      <textarea value={question} maxLength={4000} rows={2} disabled={busy} onChange={e => setQuestion(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(question); } }}
        aria-label="Ask the monitoring assistant" placeholder="Ask a question about the system or a selected location…" />
      {busy ? <button type="button" className="assistant-stop" onClick={stop}>Stop</button>
        : <button type="submit" disabled={!question.trim()}>Send</button>}
    </form>
    <div className="assistant-disclaimer">Rivora is an educational and experimental system, not an official Korean flood-warning service. Follow official alerts and instructions.</div>
  </section>;
}
