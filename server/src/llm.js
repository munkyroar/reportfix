// Thin LLM adapter. Temperature 0, JSON only, 8s timeout, 1 retry. Keys never leave the server.

const DEFAULT_MODELS = {
  gemini: 'gemini-3.5-flash-lite',
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-4o-mini',
};

export function llmConfig() {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
  const key = process.env.LLM_API_KEY || '';
  const disabled = process.env.LLM_DISABLED === 'true';
  return {
    provider,
    key,
    model: process.env.LLM_MODEL || DEFAULT_MODELS[provider] || '',
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 8000),
    enabled: !disabled && !!key && provider in DEFAULT_MODELS,
  };
}

async function post(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function callOnce(cfg, system, user, maxTokens) {
  if (cfg.provider === 'gemini') {
    const generationConfig = { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: maxTokens };
    if (/2\.5/.test(cfg.model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    else if (/gemini-[3-9]/.test(cfg.model) && !/lite/.test(cfg.model)) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    const data = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
      { 'x-goog-api-key': cfg.key },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig,
      },
      cfg.timeoutMs,
    );
    return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  }
  if (cfg.provider === 'anthropic') {
    const data = await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' },
      { model: cfg.model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] },
      cfg.timeoutMs,
    );
    return (data.content || []).map((c) => c.text || '').join('');
  }
  if (cfg.provider === 'openai') {
    const data = await post(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${cfg.key}` },
      {
        model: cfg.model, temperature: 0, max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      },
      cfg.timeoutMs,
    );
    return data.choices?.[0]?.message?.content || '';
  }
  throw new Error('No LLM provider configured');
}

export function extractJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('No JSON object in LLM output');
  return JSON.parse(t.slice(a, b + 1));
}

// validate(obj) must return parsed value or throw. Returns { value, raw, attempts } or throws last error.
export async function callJson({ system, user, validate, maxTokens = 700 }) {
  const cfg = llmConfig();
  if (!cfg.enabled) throw new Error('LLM disabled (no key/provider)');
  let lastErr, raw = '';
  // attempt 2 = the one retry; it uses LLM_MODEL_FALLBACK if set (e.g. when the main model is overloaded)
  const models = [cfg.model, process.env.LLM_MODEL_FALLBACK || cfg.model];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const c = { ...cfg, model: models[attempt - 1] };
    try {
      raw = await callOnce(c, system, user, maxTokens);
      const value = validate(extractJson(raw));
      return { value, raw, attempts: attempt, provider: `${c.provider}:${c.model}` };
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error(lastErr?.message || 'LLM failed');
  err.raw = raw;
  throw err;
}
