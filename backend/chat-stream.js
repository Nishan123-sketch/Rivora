// True upstream token streaming for the three supported providers.
// Yields text fragments as the provider produces them.
function providerRequest(system, messages, env) {
  const provider = (env.LLM_PROVIDER || 'ollama').toLowerCase();
  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'ollama') {
    return { provider, headers, url: (env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '') + '/api/chat',
      body: { model: env.LLM_MODEL || 'llama3.2', stream: true, messages: [{ role: 'system', content: system }, ...messages] } };
  }
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) throw Error('OPENAI_API_KEY is required');
    headers.Authorization = `Bearer ${env.OPENAI_API_KEY}`;
    return { provider, headers, url: 'https://api.openai.com/v1/chat/completions',
      body: { model: env.LLM_MODEL || 'gpt-4.1-mini', stream: true, messages: [{ role: 'system', content: system }, ...messages] } };
  }
  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw Error('GEMINI_API_KEY is required');
    headers['x-goog-api-key'] = env.GEMINI_API_KEY;
    return { provider, headers,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.LLM_MODEL || 'gemini-2.5-flash')}:streamGenerateContent?alt=sse`,
      body: { systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) } };
  }
  throw Error('LLM_PROVIDER must be ollama, openai or gemini');
}

// Extract the text fragment from one decoded line of the provider stream.
function parseLine(provider, line) {
  line = line.trim();
  if (!line) return '';
  if (provider === 'ollama') {
    try { return JSON.parse(line).message?.content || ''; } catch { return ''; }
  }
  if (!line.startsWith('data:')) return '';
  const data = line.slice(5).trim();
  if (data === '[DONE]') return '';
  try {
    const j = JSON.parse(data);
    if (provider === 'openai') return j.choices?.[0]?.delta?.content || '';
    return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  } catch { return ''; }
}

async function* streamProvider(system, messages, signal, fetcher = fetch, env = process.env) {
  const { provider, headers, url, body } = providerRequest(system, messages, env);
  const response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!response.ok) throw Error(`LLM provider returned HTTP ${response.status}; check configuration or quota.`);
  const decoder = new TextDecoder();
  let buffer = '', any = false;
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) { const t = parseLine(provider, line); if (t) { any = true; yield t; } }
  }
  const tail = parseLine(provider, buffer + decoder.decode());
  if (tail) { any = true; yield tail; }
  if (!any) throw Error('LLM provider returned no answer.');
}

module.exports = { streamProvider, parseLine, providerRequest };
